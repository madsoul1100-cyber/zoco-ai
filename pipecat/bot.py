import asyncio
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv

from pipecat.audio.vad.silero import SileroVADAnalyzer
try:
    from pipecat.audio.vad.vad_analyzer import VADParams
except ImportError:
    VADParams = None
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    EndFrame,
    LLMRunFrame,
    TTSSpeakFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.frame_processor import FrameProcessor
try:
    from pipecat.workers.runner import WorkerRunner
except ImportError:
    from pipecat.pipeline.runner import WorkerRunner
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import DailyRunnerArguments, RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams

from zoco_bridge import (
    fetch_snapshot,
    fire,
    post_tool,
    record_disposition,
    record_metric,
    record_status,
    record_transcript,
)

root = Path(__file__).resolve().parent
load_dotenv(root.parent / ".env")
load_dotenv(root / ".env")

CARTESIA_VOICES = {
    "female": "3b554273-4299-48b9-9aaf-eefd438e3941",
    "male": "638efaaa-4d0c-442e-b701-3fae16aad012",
}


def session_body(runner_args: RunnerArguments) -> dict:
    body = runner_args.body or {}
    if isinstance(body, dict) and isinstance(body.get("body"), dict) and "callId" not in body:
        return body["body"]
    return body if isinstance(body, dict) else {}


def speech_language(code: str) -> str:
    value = str(code or "en").lower()
    if value.startswith("hi"):
        return "hi"
    if value.startswith("te"):
        return "te"
    if value.startswith("ta"):
        return "ta"
    if value.startswith("en"):
        return "en"
    return "en"


def env_secret(name: str) -> str:
    raw = str(os.getenv(name) or "").strip()
    if not raw or raw == "..." or (raw.startswith("<") and raw.endswith(">")):
        return ""
    return raw


def cartesia_voice(gender: str | None) -> str:
    return CARTESIA_VOICES["male"] if gender == "male" else CARTESIA_VOICES["female"]


def spoken_only(text: str) -> str:
    return re.sub(r"\[END:[a-z_]+\]", "", str(text or ""), flags=re.I).strip()


class SpeakGate(FrameProcessor):
    """Tracks when Cartesia is actually playing so hangup can wait for goodbye."""

    def __init__(self):
        super().__init__()
        self.quiet = asyncio.Event()
        self.speaking = asyncio.Event()
        self.quiet.set()

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)
        if isinstance(frame, BotStartedSpeakingFrame):
            self.quiet.clear()
            self.speaking.set()
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self.speaking.clear()
            self.quiet.set()
        await self.push_frame(frame, direction)


def transport_params():
    params = {
        "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    }
    try:
        from pipecat.transports.daily.transport import DailyParams

        params["daily"] = lambda: DailyParams(audio_in_enabled=True, audio_out_enabled=True)
    except ImportError:
        pass
    return params


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    started_at = time.time()
    body = session_body(runner_args)
    call_id = str(body.get("callId") or "").strip()
    if not call_id:
        raise RuntimeError("Pipecat session body must include callId")
    bridge_url = str(body.get("bridgeUrl") or "").strip()
    if bridge_url:
        os.environ["ZOCO_BRIDGE_URL"] = bridge_url

    snapshot = await fetch_snapshot(call_id)
    channel = str(body.get("channel") or "web")
    phone = str(body.get("phone") or "").strip()
    from_number = str(body.get("fromNumber") or os.getenv("PIPECAT_FROM_NUMBER") or "").strip()
    greeting = str(snapshot.get("greeting") or "").strip()
    instructions = str(snapshot.get("instructions") or "").strip()
    language = snapshot.get("language") or snapshot.get("agent", {}).get("language") or "en-IN"
    spoken = speech_language(language)
    agent = snapshot.get("agent") or {}
    gender = "male" if agent.get("gender") == "male" else "female"
    llm_cfg = snapshot.get("llm") or {}

    await record_status(call_id, "in_progress", "agent_connected")
    await record_metric(call_id, "agent_connect_ms", int((time.time() - started_at) * 1000))

    deepgram_key = env_secret("DEEPGRAM_API_KEY")
    cartesia_key = env_secret("CARTESIA_API_KEY")
    missing = []
    if not deepgram_key:
        missing.append("DEEPGRAM_API_KEY")
    if not cartesia_key:
        missing.append("CARTESIA_API_KEY")
    if missing:
        await record_transcript(
            call_id,
            "system",
            "Local Pipecat has no audio: "
            + ", ".join(missing)
            + " is missing or still a placeholder. Put real keys in .env and restart `npm run dev:pipecat`. LiveKit Cloud keys are not reused here.",
        )

    stt = DeepgramSTTService(
        api_key=deepgram_key or os.getenv("DEEPGRAM_API_KEY"),
        settings=DeepgramSTTService.Settings(
            model=os.getenv("PIPECAT_STT_MODEL", "nova-3"),
            language=spoken,
            interim_results=True,
            endpointing=300,
            utterance_end_ms=1200,
            punctuate=True,
            smart_format=True,
        ),
    )
    tts = CartesiaTTSService(
        api_key=cartesia_key or os.getenv("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(
            voice=os.getenv("CARTESIA_VOICE_ID") or cartesia_voice(gender),
            model=os.getenv("PIPECAT_TTS_MODEL", "sonic-3"),
            language=spoken,
        ),
    )

    llm_headers = {}
    if str(llm_cfg.get("provider") or "").lower() in {"openrouter", "livekit"}:
        llm_headers = {"HTTP-Referer": "https://zoco.ai", "X-Title": "Zoco AI"}
    llm_kwargs = {}
    if llm_headers:
        llm_kwargs["headers"] = llm_headers
    if llm_cfg.get("baseUrl") or os.getenv("OPENROUTER_BASE_URL"):
        llm_kwargs["base_url"] = llm_cfg.get("baseUrl") or os.getenv("OPENROUTER_BASE_URL")
    llm = OpenAILLMService(
        api_key=llm_cfg.get("apiKey") or os.getenv("OPENROUTER_API_KEY") or os.getenv("OPENAI_API_KEY"),
        settings=OpenAILLMService.Settings(
            model=llm_cfg.get("model") or os.getenv("OPENROUTER_MODEL") or os.getenv("OPENAI_MODEL") or "gpt-4.1",
            system_instruction=instructions
            or f"You are {agent.get('name') or 'Zoco'}, on a live phone call. Keep replies short and natural.",
        ),
        **llm_kwargs,
    )

    worker_ref: dict = {}
    ending = {"done": False}
    speak_gate = SpeakGate()

    async def finish(disposition: str, reason: str):
        if ending["done"]:
            return
        ending["done"] = True
        await record_disposition(call_id, disposition, reason)
        worker = worker_ref.get("worker")
        if worker:
            await worker.queue_frames([EndFrame()])

    async def speak_then_hangup(text: str, disposition: str, reason: str):
        spoken_line = spoken_only(text)
        worker = worker_ref.get("worker")
        if spoken_line and worker:
            await worker.queue_frames([TTSSpeakFrame(spoken_line)])
            await record_transcript(call_id, "assistant", spoken_line)
            try:
                if speak_gate.quiet.is_set():
                    await asyncio.wait_for(speak_gate.speaking.wait(), timeout=4)
                await asyncio.wait_for(speak_gate.quiet.wait(), timeout=12)
            except asyncio.TimeoutError:
                await asyncio.sleep(2)
            await asyncio.sleep(0.4)
        await finish(disposition, reason)

    async def query_knowledge(params: FunctionCallParams, question: str):
        """Look up facts from attached knowledge bases. Use when the caller asks a factual question.

        Args:
            question: The caller's factual question.
        """
        result = await post_tool(call_id, "query_knowledge", {"question": question})
        await params.result_callback(result.get("result") or "No matching knowledge.")

    async def end_interaction(params: FunctionCallParams, goodbye: str, disposition: str):
        """End the call only after the caller clearly refuses, asks to stop, or finishes the flow.

        Args:
            goodbye: The exact short closing line spoken to the caller before hangup.
            disposition: not_interested | do_not_call | success | callback_requested | wrong_person | qualified
        """
        spoken_line = spoken_only(goodbye)
        await params.result_callback("Call ended.")
        await speak_then_hangup(
            spoken_line,
            disposition or "success",
            "agent_end",
        )

    async def transfer_to_human(params: FunctionCallParams, reason: str = "", number: str = ""):
        """Warm-transfer the live call to a human. Speak a one-line handoff first.

        Args:
            reason: Why the caller needs a human.
            number: Optional destination number.
        """
        result = await post_tool(call_id, "transfer_to_human", {"reason": reason, "number": number})
        spoken_line = spoken_only(result.get("say") or "I am connecting you to a teammate now.")
        await params.result_callback(result.get("result") or "Transfer requested.")
        await speak_then_hangup(
            spoken_line,
            result.get("disposition") or "success",
            f"transfer:{result.get('transfer') or number or 'human'}",
        )

    tools = [query_knowledge, end_interaction, transfer_to_human]
    for tool in agent.get("customTools") or []:
        name = str(tool.get("name") or "").strip()
        if not name:
            continue
        description = tool.get("description") or f"Call the {name} HTTP API"

        async def custom_tool(params: FunctionCallParams, note: str = "", _name=name):
            result = await post_tool(call_id, _name, {"note": note})
            await params.result_callback(result.get("result") or "Done.")

        custom_tool.__name__ = name
        custom_tool.__doc__ = f"{description}\n\nArgs:\n    note: Optional note to pass to the API."
        tools.append(custom_tool)

    context = LLMContext(tools=tools)
    try:
        vad = SileroVADAnalyzer(
            params=VADParams(
                confidence=0.7,
                start_secs=0.12,
                stop_secs=0.2,
                min_volume=0.6,
            )
        ) if VADParams else SileroVADAnalyzer()
    except TypeError:
        vad = SileroVADAnalyzer()
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=vad),
    )
    user_aggregator = aggregators.user() if hasattr(aggregators, "user") else aggregators[0]
    assistant_aggregator = aggregators.assistant() if hasattr(aggregators, "assistant") else aggregators[1]

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            speak_gate,
            assistant_aggregator,
        ]
    )

    runner = WorkerRunner(handle_sigint=getattr(runner_args, "handle_sigint", False))
    worker = PipelineWorker(
        pipeline,
        name="zoco-pipecat",
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
    )
    worker_ref["worker"] = worker
    greeted = {"done": False}

    async def start_conversation():
        if greeted["done"]:
            return
        greeted["done"] = True
        if greeting:
            await worker.queue_frames([TTSSpeakFrame(greeting)])
            await record_transcript(call_id, "assistant", greeting)
            return
        await worker.queue_frames([LLMRunFrame()])

    @user_aggregator.event_handler("on_user_turn_stopped")
    async def on_user_turn_stopped(aggregator, strategy, message):
        text = getattr(message, "content", None) or ""
        if text:
            fire(record_transcript(call_id, "user", text))

    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_assistant_turn_stopped(aggregator, message):
        text = getattr(message, "content", None) or ""
        if text:
            fire(record_transcript(call_id, "assistant", text))

    rtvi = getattr(worker, "rtvi", None)
    if rtvi is not None:
        @rtvi.event_handler("on_client_ready")
        async def on_client_ready(rtvi_processor):
            await rtvi_processor.set_bot_ready()
            if channel != "telephony":
                await start_conversation()

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        if channel != "telephony" and rtvi is None:
            await start_conversation()

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        if not ending["done"]:
            fire(record_status(call_id, "dropped", "client_disconnected"))
        await runner.cancel()

    async def maybe_dialout():
        if channel != "telephony" or not phone:
            return
        start_dialout = getattr(transport, "start_dialout", None)
        if not callable(start_dialout):
            return
        payload = {"phoneNumber": phone}
        if from_number:
            payload["callerId"] = from_number
        await start_dialout(payload)

    if isinstance(runner_args, DailyRunnerArguments) or hasattr(transport, "start_dialout"):
        @transport.event_handler("on_joined")
        async def on_joined(transport, data):
            await maybe_dialout()

        @transport.event_handler("on_dialout_answered")
        async def on_dialout_answered(transport, data):
            await start_conversation()

        @transport.event_handler("on_first_participant_joined")
        async def on_first_participant_joined(transport, participant):
            if channel == "telephony":
                await start_conversation()

    await runner.add_workers(worker)
    await runner.run()


async def bot(runner_args: RunnerArguments):
    transport = await create_transport(runner_args, transport_params())
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import app, main

    @app.get("/healthz")
    async def healthz():
        return {
            "ok": True,
            "deepgram": bool(os.getenv("DEEPGRAM_API_KEY")),
            "cartesia": bool(os.getenv("CARTESIA_API_KEY")),
        }

    main()
