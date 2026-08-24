import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { MessageTimeline, PageHeader, StatusBadge } from "../components/ui.jsx";
import { AgentEditor } from "../components/AgentEditor.jsx";
import { languageLabel } from "../lib/languages.js";
import { loadVoices, pickVoice, speakText, playAudio, voicesForLang, spokenForTts, isNoiseTranscript } from "../lib/voice.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function AgentStudio() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const presetCallId = searchParams.get("call");
  const launchedRef = useRef(false);
  const navigate = useNavigate();
  const [agent, setAgent] = useState(null);
  const [call, setCall] = useState(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("chat");
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [llm, setLlm] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [allVoices, setAllVoices] = useState([]);
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");
  const [liveText, setLiveText] = useState("");
  const [heardText, setHeardText] = useState("");
  const recorder = useRef(null);
  const chunks = useRef([]);
  const callRef = useRef(null);
  const speakingRef = useRef(false);
  const recognitionRef = useRef(null);
  const sendingRef = useRef(false);
  const wantListenRef = useRef(false);
  const transcriptRef = useRef("");
  const heardRef = useRef("");
  const silenceRef = useRef(null);
  const voiceRef = useRef(null);
  const modeRef = useRef("chat");
  const agentRef = useRef(null);
  const lastSpokenRef = useRef("");
  const ignoreUntilRef = useRef(0);

  useEffect(() => {
    api.agent(id).then(setAgent).catch((err) => setError(err.message));
    api.providers().then(setCatalog).catch(() => {});
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setLlm(data.llm))
      .catch(() => {});
    loadVoices().then((list) => {
      setAllVoices(list);
    });
    return () => {
      wantListenRef.current = false;
      stopListening();
      window.speechSynthesis?.cancel();
    };
  }, [id]);

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    if (!agent || !catalog || agent.llmProvider) return;
    const provider = catalog.defaultLlmProvider || "openrouter";
    const model = catalog.llm.find((item) => item.id === provider)?.models[0]?.id || "";
    setAgent((current) => ({
      ...current,
      llmProvider: provider,
      llmModel: current.llmModel || model,
      ttsProvider: current.ttsProvider || catalog.defaultTtsProvider || "browser",
    }));
  }, [agent, catalog]);

  useEffect(() => {
    if (!allVoices.length) return;
    const lang = agent?.language || "en-IN";
    const matching = voicesForLang(allVoices, lang);
    setVoices(matching);
    const chosen = pickVoice(allVoices, voiceName || agent?.voice, lang);
    if (chosen) {
      setVoiceName(chosen.name);
      voiceRef.current = chosen;
    }
  }, [agent?.language, allVoices]);

  useEffect(() => {
    const chosen = voices.find((voice) => voice.name === voiceName);
    if (chosen) voiceRef.current = chosen;
  }, [voiceName, voices]);

  async function saveAgent(payload) {
    setError("");
    try {
      setAgent(await api.updateAgent(id, payload));
    } catch (err) {
      setError(err.message);
    }
  }

  function isLive(current = callRef.current) {
    return current && ["in_progress", "ringing"].includes(current.status);
  }

  async function goLive(existing) {
    setError("");
    setLiveText("");
    setHeardText("");
    setMode("voice");
    modeRef.current = "voice";
    wantListenRef.current = false;
    stopListening();
    callRef.current = existing;
    setCall(existing);
    await startMic(existing.id);
    const connected = existing.status === "in_progress"
      ? existing
      : await api.connect(existing.id);
    callRef.current = connected;
    setCall(connected);
    const greeting =
      [...connected.messages].reverse().find((m) => m.role === "assistant")?.text || agent.greeting;
    await speak(greeting);
    await delay(700);
    if (isLive(connected)) startPersistentListen();
  }

  useEffect(() => {
    if (!agent || !presetCallId || launchedRef.current) return;
    launchedRef.current = true;
    (async () => {
      try {
        let current = await api.call(presetCallId);
        if (current.status === "queued") current = await api.startOutbound(presetCallId);
        await goLive(current);
      } catch (err) {
        setError(err.message);
        launchedRef.current = false;
      }
    })();
  }, [agent, presetCallId]);

  async function startSession(channel) {
    setError("");
    setLiveText("");
    setHeardText("");
    setMode(channel);
    modeRef.current = channel;
    wantListenRef.current = false;
    stopListening();
    const next = await api.startCall({
      agentId: id,
      channel,
      language: agent?.language,
      customer: { name: "Test customer", phone: "+910000000000" },
    });
    callRef.current = next;
    setCall(next);
    if (channel !== "voice") {
      setPhase("idle");
      return;
    }
    await goLive(next);
  }

  async function send(text = draft) {
    const current = callRef.current;
    const spoken = String(text || "").trim();
    if (!current || !spoken || sendingRef.current) return;
    if (modeRef.current === "voice" && isNoiseTranscript(spoken, lastSpokenRef.current)) {
      transcriptRef.current = "";
      heardRef.current = "";
      setHeardText("");
      return;
    }
    sendingRef.current = true;
    wantListenRef.current = false;
    clearTimeout(silenceRef.current);
    stopListening();
    setDraft("");
    transcriptRef.current = "";
    heardRef.current = "";
    setHeardText("");
    setLiveText("");
    setPhase("thinking");
    try {
      if (modeRef.current === "voice") {
        const next = await api.sendMessageStream(current.id, spoken, {
          source: "voice",
          onDelta: (token) => {
            setLiveText((prev) => `${prev}${token}`.replace(/\[END:[a-z_]+\]/gi, ""));
          },
        });
        if (next) {
          callRef.current = next;
          setCall(next);
          const last = [...next.messages].reverse().find((m) => m.role === "assistant");
          setLiveText("");
          if (last?.text) await speak(last.text);
          await delay(700);
          sendingRef.current = false;
          if (isLive(next)) {
            wantListenRef.current = true;
            setPhase("listening");
            startRecognition();
          } else {
            setPhase("idle");
          }
          return;
        }
      } else {
        const next = await api.sendMessage(current.id, spoken, modeRef.current === "voice" ? "voice" : "chat");
        callRef.current = next;
        setCall(next);
        setPhase("idle");
      }
    } catch (err) {
      setError(err.message);
      setPhase("idle");
    } finally {
      sendingRef.current = false;
    }
  }

  async function mark(status, disposition, reason) {
    const current = callRef.current;
    if (!current) return;
    wantListenRef.current = false;
    stopListening();
    window.speechSynthesis?.cancel();
    const next = await api.outcome(current.id, { status, disposition, reason });
    callRef.current = next;
    setCall(next);
    setPhase("idle");
    await stopMic();
  }

  async function startMic(callId) {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const media = new MediaRecorder(stream);
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    media.onstop = async () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      if (blob.size) {
        try {
          await api.uploadRecording(callId, blob);
        } catch {
          /* optional */
        }
      }
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.current = media;
    media.start();
  }

  async function stopMic() {
    wantListenRef.current = false;
    stopListening();
    speakingRef.current = false;
    if (recorder.current?.state === "recording") recorder.current.stop();
    window.speechSynthesis?.cancel();
  }

  async function speak(text) {
    wantListenRef.current = false;
    stopListening();
    const display = String(text || "").replace(/\[END:[a-z_]+\]/gi, "").trim();
    const clean = spokenForTts(display);
    if (!clean) return;
    lastSpokenRef.current = display;
    speakingRef.current = true;
    setPhase("speaking");
    const spokenLang = callRef.current?.language || agentRef.current?.language || "en-IN";
    const ttsProvider = agentRef.current?.ttsProvider || "browser";
    if (ttsProvider !== "browser") {
      try {
        const clip = await api.speak({
          text: display,
          agentId: agentRef.current?.id,
          ttsProvider,
          ttsVoice: agentRef.current?.ttsVoice,
          ttsModel: agentRef.current?.ttsModel,
          language: spokenLang,
        });
        if (clip?.provider === "browser" || !clip?.audioUrl) {
          throw new Error("Selected voice is not connected. Add the API key in Settings.");
        }
        await playAudio(clip.audioUrl);
      } catch (err) {
        setError(err.message || "Selected voice failed. Check Settings for the provider key.");
      }
    } else {
      await speakText(clean, {
        voice: voiceRef.current,
        lang: spokenLang,
        rate: 0.96,
        pitch: 1,
        cancel: true,
      });
    }
    speakingRef.current = false;
    ignoreUntilRef.current = Date.now() + 600;
  }

  function stopListening() {
    clearTimeout(silenceRef.current);
    try {
      recognitionRef.current?.abort();
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null;
  }

  function SpeechEngine() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  function startPersistentListen() {
    wantListenRef.current = true;
    transcriptRef.current = "";
    startRecognition();
  }

  function startRecognition() {
    const Speech = SpeechEngine();
    if (!Speech) {
      setError("Voice listening needs Chrome or Edge. You can still type.");
      return;
    }
    if (recognitionRef.current) return;
    const recognition = new Speech();
    recognition.lang = callRef.current?.language || agentRef.current?.language || "en-IN";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (speakingRef.current || sendingRef.current) return;
      if (Date.now() < ignoreUntilRef.current) return;
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += `${piece} `;
        else interim += piece;
      }
      if (finalText) transcriptRef.current = `${transcriptRef.current} ${finalText}`.trim();
      const combined = `${transcriptRef.current} ${interim}`.trim();
      heardRef.current = combined;
      setHeardText(combined);
      clearTimeout(silenceRef.current);
      if (combined.length >= 2) {
        silenceRef.current = setTimeout(() => {
          const spoken = (transcriptRef.current || heardRef.current || "").trim();
          if (spoken.length >= 2 && !speakingRef.current && !sendingRef.current) {
            if (isNoiseTranscript(spoken, lastSpokenRef.current)) {
              transcriptRef.current = "";
              heardRef.current = "";
              setHeardText("");
              return;
            }
            send(spoken);
          }
        }, 1100);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed") {
        wantListenRef.current = false;
        setError("Allow microphone access for this site, then click Test voice again.");
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (wantListenRef.current && !speakingRef.current && !sendingRef.current && isLive()) {
        setTimeout(() => {
          if (wantListenRef.current && !recognitionRef.current) startRecognition();
        }, 180);
      }
    };

    try {
      recognition.start();
      setPhase("listening");
    } catch (err) {
      if (!String(err.message).includes("started")) setError(err.message);
    }
  }

  if (error && !agent) return <p className="error">{error}</p>;
  if (!agent) return <p className="muted">Loading studio…</p>;

  const live = call && ["in_progress", "ringing"].includes(call.status);
  const phaseLabel = {
    idle: live ? "Mic is live — just speak" : "Voice idle",
    speaking: "Agent speaking…",
    listening: "Listening — just talk",
    thinking: "Thinking…",
  }[phase];

  return (
    <>
      <PageHeader
        title={agent.name}
        subtitle={`${agent.direction} agent · ${languageLabel(agent.language || "en-IN")}`}
        actions={
          <>
            <span className={`badge ${(agent.llmProvider ? catalog?.llm?.find((item) => item.id === agent.llmProvider)?.ready : llm?.ready) ? "done" : "recall"}`}>
              {agent.llmProvider
                ? `${agent.llmProvider} · ${agent.llmModel || "default"}`
                : llm?.ready
                  ? `${llm.provider} · ${llm.model}`
                  : "add an AI key in Settings"}
            </span>
            <button className="btn ghost" onClick={() => startSession("chat")}>Test chat</button>
            <button className="btn" onClick={() => startSession("voice")}>Test voice</button>
          </>
        }
      />

      <div className="grid split studio">
        <AgentEditor
          agent={agent}
          onChange={setAgent}
          onSubmit={saveAgent}
          onError={setError}
          submitLabel="Save agent"
        />

        <section className="card chat">
          {mode === "voice" ? (
            <div className="voice-stage compact">
              {live && (phase === "speaking" || phase === "listening") ? <div className="pulse" /> : null}
              <div>
                <strong>{phaseLabel}</strong>
                <div className="muted">Wait until the agent finishes, then speak. Hindi and other Indian voices will not read ? or ! out loud.</div>
              </div>
            </div>
          ) : null}

          {error ? <p className="error">{error}</p> : null}

          {call ? (
            <>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                <StatusBadge status={call.status} disposition={call.disposition} />
                <button className="btn ghost" onClick={() => navigate(`/calls/${call.id}`)}>Open JSON</button>
              </div>
              <MessageTimeline messages={call.messages} liveText={liveText} heardText={heardText} />
              {live ? (
                <div className="composer">
                  <input
                    className="input"
                    value={draft}
                    placeholder="Type only if the mic misses you"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                  />
                  <button className="btn" onClick={() => send()}>Send</button>
                </div>
              ) : (
                <p className="muted">Call closed as {call.disposition?.replaceAll("_", " ")}.</p>
              )}
              {live ? (
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn secondary" onClick={() => mark("completed", agent.defaultSuccessDisposition || "success", "Marked successful")}>Mark successful</button>
                  <button className="btn ghost" onClick={() => mark("dropped", "dropped", "Dropped mid-call")}>Dropped</button>
                  <button className="btn ghost" onClick={() => mark("completed", "callback_requested", "Customer asked for a recall")}>Recall later</button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted">Click Test voice once, allow the mic, then just talk. Chrome or Edge works best.</p>
          )}
        </section>
      </div>
    </>
  );
}
