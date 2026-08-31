import { WebSocketServer } from "ws";
import { v4 as uuid } from "uuid";
import { handleSessionTurn } from "./livekitSession.js";
import { buildSessionSnapshot } from "./livekitSession.js";
import { synthesizeSpeech } from "./tts.js";
import { transcribeAudio } from "./stt.js";
import { resolveTtsConfig, sarvamTtsLanguage } from "./providers.js";
import { spokenForTts } from "../languages.js";
import { applyPronunciations } from "./pronunciation.js";
import { getCall, getCallAgent, saveCall } from "../store.js";
import { attachTurn } from "../services/calling.js";
import { getAiSettings } from "../store.js";
import { silenceAction } from "./callBehavior.js";
import {
  isMeaningfulBargeIn,
  isNoiseTranscript,
  normalizeVoiceTranscript,
  nudgeDelayMs,
  pcmRms,
  rmsFromDb,
  silenceMsFromEagerness,
} from "./voiceSignal.js";

const CHUNK_BYTES = 3200;
const BARGE_IN_CHUNKS = 4;
const POST_SPEAK_GRACE_MS = 450;

function parseMessage(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function wavToPcm(buffer) {
  if (buffer.length < 44) return { pcm: buffer, sampleRate: 8000 };
  const sampleRate = buffer.readUInt32LE(24);
  return { pcm: buffer.subarray(44), sampleRate };
}

function chunkPcm(pcm) {
  const chunks = [];
  for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
    const slice = pcm.subarray(offset, offset + CHUNK_BYTES);
    if (slice.length % 320 !== 0) {
      const padded = Buffer.alloc(Math.ceil(slice.length / 320) * 320);
      slice.copy(padded);
      chunks.push(padded);
    } else {
      chunks.push(slice);
    }
  }
  return chunks;
}

async function synthesizeExotelPcm(agent, text, sampleRate = 16000) {
  const settings = await getAiSettings();
  const tts = resolveTtsConfig(agent, settings);
  if (!tts.ready || tts.provider !== "sarvam") {
    const spoken = await synthesizeSpeech({
      agent,
      text,
      settings,
      skipAmbient: true,
      source: "exotel",
    });
    if (!spoken?.id) return Buffer.alloc(0);
    const { getTtsClip } = await import("./tts.js");
    const clip = await getTtsClip(spoken.id);
    if (!clip?.buffer || clip.ext !== "wav") return Buffer.alloc(0);
    return wavToPcm(clip.buffer).pcm;
  }
  const pronounced = applyPronunciations(text, agent?.language || "en-IN", agent?.callSettings?.pronunciations);
  const spoken = spokenForTts(pronounced).slice(0, 1400);
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": tts.apiKey,
      Authorization: `Bearer ${tts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: spoken,
      target_language_code: sarvamTtsLanguage(agent?.language || "en-IN"),
      speaker: tts.voice || "priya",
      model: tts.model || "bulbul:v3",
      pace: 0.95,
      speech_sample_rate: sampleRate,
      output_audio_codec: "wav",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Sarvam TTS failed");
  const encoded = data.audios?.[0] || data.audio;
  if (!encoded) return Buffer.alloc(0);
  return wavToPcm(Buffer.from(encoded, "base64")).pcm;
}

class ExotelStreamSession {
  constructor({ ws, callId, sampleRate, agent }) {
    this.ws = ws;
    this.callId = callId;
    this.sampleRate = sampleRate;
    this.agent = agent || {};
    this.streamSid = "";
    this.buffer = Buffer.alloc(0);
    this.speaking = false;
    this.speakGen = 0;
    this.processing = false;
    this.closed = false;
    this.lastVoiceAt = 0;
    this.voiceStarted = false;
    this.lastSpokenText = "";
    this.ignoreMediaUntil = 0;
    this.bargeInChunks = 0;
    this.energyThreshold = rmsFromDb(agent?.callSettings?.volumeThresholdDb ?? -48);
    this.silenceMs = silenceMsFromEagerness(agent?.callSettings?.eagerness ?? 7);
    this.minVoiceBytes = Math.floor(sampleRate * 2 * 0.35);
    this.allowInterrupt = agent?.callSettings?.allowInterrupt !== false;
    this.nudgeTimer = null;
    this.speakChain = Promise.resolve();
  }

  configureAgent(agent) {
    if (!agent) return;
    this.agent = agent;
    this.energyThreshold = rmsFromDb(agent?.callSettings?.volumeThresholdDb ?? -48);
    this.silenceMs = silenceMsFromEagerness(agent?.callSettings?.eagerness ?? 7);
    this.allowInterrupt = agent?.callSettings?.allowInterrupt !== false;
  }

  resetNudgeTimer() {
    clearTimeout(this.nudgeTimer);
    if (this.closed || !this.agent?.callSettings?.nudgeEnabled) return;
    this.nudgeTimer = setTimeout(() => {
      this.handleSilenceNudge().catch((error) => {
        console.warn("Exotel silence nudge failed:", error.message);
      });
    }, nudgeDelayMs(this.agent));
  }

  async handleSilenceNudge() {
    if (this.closed || this.speaking || this.processing) {
      this.resetNudgeTimer();
      return;
    }
    const call = await getCall(this.callId);
    const agent = await getCallAgent(call);
    if (!call || !agent) return;
    this.configureAgent(agent);
    const action = silenceAction(call, agent);
    if (action.kind !== "nudge" || !action.text) return;
    call.nudgeIndex = action.nextIndex;
    await saveCall(call);
    await this.enqueueSpeak(action.text);
    this.resetNudgeTimer();
  }

  interruptSpeaking() {
    if (!this.speaking) return;
    this.speakGen += 1;
    this.speaking = false;
    this.bargeInChunks = 0;
    this.buffer = Buffer.alloc(0);
    this.voiceStarted = false;
    if (this.ws.readyState === this.ws.OPEN && this.streamSid) {
      this.ws.send(JSON.stringify({ event: "clear", stream_sid: this.streamSid }));
    }
  }

  appendPcm(pcm) {
    const rms = pcmRms(pcm);
    const loud = rms >= this.energyThreshold;
    if (this.speaking) {
      if (!this.allowInterrupt) return;
      if (!loud) {
        this.bargeInChunks = 0;
        return;
      }
      this.bargeInChunks += 1;
      if (this.bargeInChunks < BARGE_IN_CHUNKS) return;
      this.interruptSpeaking();
    }
    if (Date.now() < this.ignoreMediaUntil) return;
    if (!loud && !this.voiceStarted) return;
    if (loud) this.voiceStarted = true;
    this.buffer = Buffer.concat([this.buffer, pcm]);
    this.lastVoiceAt = Date.now();
  }

  async enqueueSpeak(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    this.speakChain = this.speakChain.then(() => this.speakNow(clean));
    await this.speakChain;
  }

  async speakNow(text) {
    const gen = ++this.speakGen;
    this.speaking = true;
    this.ignoreMediaUntil = Date.now() + POST_SPEAK_GRACE_MS;
    this.lastSpokenText = text;
    try {
      const call = await getCall(this.callId);
      const agent = await getCallAgent(call);
      if (!call || !agent || this.closed) return;
      this.configureAgent(agent);
      const pcm = await synthesizeExotelPcm(agent, text, this.sampleRate);
      if (!pcm.length || gen !== this.speakGen) return;
      for (const chunk of chunkPcm(pcm)) {
        if (gen !== this.speakGen || this.ws.readyState !== this.ws.OPEN) return;
        this.ws.send(JSON.stringify({
          event: "media",
          stream_sid: this.streamSid,
          media: { payload: chunk.toString("base64") },
        }));
      }
      const durationMs = Math.ceil((pcm.length / (this.sampleRate * 2)) * 1000);
      this.ignoreMediaUntil = Date.now() + durationMs + POST_SPEAK_GRACE_MS;
    } catch (error) {
      console.warn("Exotel speak failed:", error.message);
    } finally {
      if (gen === this.speakGen) {
        this.speaking = false;
        this.bargeInChunks = 0;
        this.resetNudgeTimer();
      }
    }
  }

  async flushIfSilent() {
    if (this.processing || this.closed || this.speaking) return;
    if (!this.voiceStarted || this.buffer.length < this.minVoiceBytes) return;
    if (Date.now() - this.lastVoiceAt < this.silenceMs) return;

    this.processing = true;
    const pcm = this.buffer;
    this.buffer = Buffer.alloc(0);
    this.voiceStarted = false;
    try {
      const call = await getCall(this.callId);
      const agent = await getCallAgent(call);
      if (!call || !agent) return;
      this.configureAgent(agent);

      const wav = pcmToWav(pcm, this.sampleRate);
      const rawTranscript = await transcribeAudio(wav, {
        language: call.language || agent.language || "te-IN",
        mime: "audio/wav",
        filename: "utterance.wav",
      });
      const transcript = normalizeVoiceTranscript(rawTranscript);
      if (!transcript || isNoiseTranscript(transcript, this.lastSpokenText)) {
        this.resetNudgeTimer();
        return;
      }
      if (this.speaking && !(this.allowInterrupt && isMeaningfulBargeIn(transcript))) {
        return;
      }
      if (this.speaking) this.interruptSpeaking();

      clearTimeout(this.nudgeTimer);
      call.nudgeIndex = 0;

      const reply = await handleSessionTurn(this.callId, {
        eventId: `exotel_${uuid().slice(0, 8)}`,
        userText: transcript,
        sttLanguage: call.language || agent.language || null,
      });
      if (reply.text) {
        await this.enqueueSpeak(reply.text);
      }
      if (reply.endCall) {
        this.closed = true;
        clearTimeout(this.nudgeTimer);
        setTimeout(() => {
          try {
            this.ws.close();
          } catch {
            /* ignore */
          }
        }, 1200);
      }
    } catch (error) {
      console.warn("Exotel stream turn failed:", error.message);
    } finally {
      this.processing = false;
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.nudgeTimer);
    this.speakGen += 1;
    this.speaking = false;
  }
}

export function mountExotelStream(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    try {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname !== "/api/exotel/stream") return;
      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit("connection", client, url);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", async (ws, url) => {
    const callId = String(url.searchParams.get("callId") || "").trim();
    const sampleRate = Number(url.searchParams.get("sample-rate") || 16000) || 16000;
    if (!callId) {
      ws.close();
      return;
    }

    const call = await getCall(callId);
    const agent = await getCallAgent(call);
    const session = new ExotelStreamSession({ ws, callId, sampleRate, agent });
    const tick = setInterval(() => {
      session.flushIfSilent().catch(() => {});
    }, 200);

    ws.on("message", async (raw) => {
      const event = parseMessage(raw);
      if (!event) return;

      if (event.event === "start") {
        session.streamSid = event.start?.stream_sid || event.stream_sid || "";
        try {
          const snapshot = await buildSessionSnapshot(callId);
          const liveCall = await getCall(callId);
          const liveAgent = await getCallAgent(liveCall);
          session.configureAgent(liveAgent);
          if (liveCall && liveAgent && snapshot.greeting) {
            liveCall.status = "in_progress";
            liveCall.disposition = "in_progress";
            liveCall.runtime = "exotel";
            liveCall.exotel = { streamSid: session.streamSid };
            liveCall.nudgeIndex = 0;
            if (!liveCall.startedAt) liveCall.startedAt = new Date().toISOString();
            await attachTurn(liveCall, {
              id: `msg_${uuid().slice(0, 8)}`,
              role: "assistant",
              text: snapshot.greeting,
              timestamp: new Date().toISOString(),
              audioOffsetMs: null,
            }, "exotel");
            await saveCall(liveCall);
            await session.enqueueSpeak(snapshot.greeting);
          }
        } catch (error) {
          console.warn("Exotel greeting failed:", error.message);
        }
        return;
      }

      if (event.event === "media" && event.media?.payload) {
        session.appendPcm(Buffer.from(event.media.payload, "base64"));
        return;
      }

      if (event.event === "stop") {
        session.close();
        clearInterval(tick);
      }
    });

    ws.on("close", () => {
      session.close();
      clearInterval(tick);
    });
  });

  return wss;
}
