import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { llmHeaders, resolveTtsConfig, sarvamTtsLanguage } from "./providers.js";
import { spokenForTts } from "../languages.js";
import { DATA_DIR } from "../store.js";
import { ambientEnabled, ambientVolume, mixAmbientIntoSpeech } from "./ambient.js";
import { applyPronunciations, ensureSarvamDictId, pronunciationCount } from "./pronunciation.js";

const TTS_DIR = path.join(DATA_DIR, "tts");

function clipId({ provider, model, voice, language, text }) {
  return createHash("sha1")
    .update([provider, model, voice, language, text].join("|"))
    .digest("hex")
    .slice(0, 16);
}

export function ttsPath(id, ext = "mp3") {
  return path.join(TTS_DIR, `${id}.${ext}`);
}

export async function getTtsClip(id) {
  for (const ext of ["mp3", "wav", "ogg"]) {
    try {
      const filePath = ttsPath(id, ext);
      const buffer = await readFile(filePath);
      const contentType = ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : "audio/mpeg";
      return { buffer, contentType, ext };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function saveClip(id, buffer, ext = "mp3") {
  await mkdir(TTS_DIR, { recursive: true });
  const filePath = ttsPath(id, ext);
  await writeFile(filePath, buffer);
  return { id, ext, contentType: ext === "wav" ? "audio/wav" : "audio/mpeg" };
}

export function voiceDynamics(agent) {
  const settings = agent?.callSettings || {};
  // Keep pace locked — varying speed between clips makes it sound like two speakers.
  let pace = Math.min(2, Math.max(0.5, Number(settings.speakingSpeed ?? 0.95) || 0.95));
  if (pace > 1.02) pace = 1.02;
  const pitch = Math.min(0.75, Math.max(-0.75, Number(settings.pitch ?? 0) || 0));
  // Lower temperature = one consistent speaker across the whole turn.
  const temperature = Math.min(0.75, Math.max(0.2, Number(settings.ttsTemperature ?? 0.42) || 0.42));
  return { pace, pitch, temperature };
}

function isSarvamV2(model) {
  return String(model || "").includes("v2") && !String(model || "").includes("v3");
}

async function synthesizeSarvam({
  text,
  language,
  voice,
  model,
  apiKey,
  pace = 1,
  pitch = 0,
  temperature = 0.42,
  dictId = "",
  sampleRate = 24000,
}) {
  const payload = {
    text,
    target_language_code: sarvamTtsLanguage(language),
    speaker: voice || "priya",
    model: model || "bulbul:v3",
    pace: Math.min(2, Math.max(0.5, Number(pace) || 0.95)),
    speech_sample_rate: Number(sampleRate) || 24000,
    output_audio_codec: "mp3",
  };
  if (isSarvamV2(payload.model)) {
    payload.pitch = pitch;
  } else {
    // Cap expressiveness so consecutive clips stay the same speaker.
    payload.temperature = Math.min(0.75, Math.max(0.01, Number(temperature) || 0.42));
  }
  if (dictId && !isSarvamV2(payload.model)) payload.dict_id = dictId;
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `Sarvam TTS ${response.status}`);
  }
  const encoded = data.audios?.[0] || data.audio;
  if (!encoded) throw new Error("Sarvam TTS returned no audio");
  const buffer = Buffer.from(encoded, "base64");
  const ext = buffer[0] === 0x52 && buffer[1] === 0x49 ? "wav" : "mp3";
  return { buffer, ext };
}

async function synthesizeOpenAi({ text, voice, model, apiKey, speed = 1 }) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: llmHeaders({ provider: "openai", apiKey }),
    body: JSON.stringify({
      model: model || "tts-1-hd",
      voice: voice || "nova",
      input: text,
      response_format: "mp3",
      speed: Math.min(4, Math.max(0.25, Number(speed) || 1)),
    }),
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`OpenAI TTS ${response.status}: ${raw.slice(0, 240)}`);
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), ext: "mp3" };
}

export async function synthesizeSpeech({
  agent,
  text,
  settings,
  publicBaseUrl = "",
  skipAmbient = false,
  source = "",
}) {
  const callSettings = agent?.callSettings || {};
  const pronunciations = callSettings.pronunciations || null;
  const pronounced = applyPronunciations(text, agent?.language || "en-IN", pronunciations);
  const spoken = spokenForTts(pronounced).slice(0, 1400);
  if (!spoken) return null;
  const tts = resolveTtsConfig(agent, settings);
  if (!tts.ready || tts.provider === "browser") {
    if (tts.provider !== "browser") {
      throw new Error(`Add a ${tts.provider} API key in Settings to use this voice.`);
    }
    return { provider: "browser", text: spoken };
  }
  const { pace, pitch, temperature } = voiceDynamics(agent);
  const withAmbient = !skipAmbient && ambientEnabled(callSettings);
  const ambVol = ambientVolume(callSettings);
  // 24 kHz mp3 — fast to synthesize and play; one clip per turn keeps voice consistent.
  const sampleRate = 24000;
  let dictId = String(callSettings.sarvamDictId || "").trim();
  if (!dictId && tts.provider === "sarvam" && pronunciationCount(pronunciations) > 0) {
    try {
      dictId = await ensureSarvamDictId(tts.apiKey, pronunciations);
      if (dictId && agent?.callSettings) agent.callSettings.sarvamDictId = dictId;
    } catch (error) {
      console.warn("Sarvam pronunciation dict upload skipped:", error.message);
    }
  }
  const id = clipId({
    provider: tts.provider,
    model: tts.model,
    voice: tts.voice,
    language: tts.language,
    text: `${spoken}|p${pace}|t${pitch}|e${temperature}|r${sampleRate}|d${dictId || "local"}|a${withAmbient ? ambVol : 0}`,
  });
  const existing = await getTtsClip(id);
  if (!existing) {
    let made =
      tts.provider === "sarvam"
        ? await synthesizeSarvam({
            text: spoken,
            language: tts.language,
            voice: tts.voice,
            model: tts.model,
            apiKey: tts.apiKey,
            pace,
            pitch,
            temperature,
            dictId,
            sampleRate,
          })
        : await synthesizeOpenAi({
            text: spoken,
            voice: tts.voice,
            model: tts.model || "tts-1-hd",
            apiKey: tts.apiKey,
            speed: pace,
          });
    if (withAmbient) {
      const mixed = await mixAmbientIntoSpeech(made.buffer, { volume: ambVol, ext: made.ext });
      made = { buffer: mixed, ext: "mp3" };
    }
    await saveClip(id, made.buffer, made.ext);
  }
  const clip = await getTtsClip(id);
  return {
    provider: tts.provider,
    id,
    voice: tts.voice,
    model: tts.model,
    contentType: clip.contentType,
    audioUrl: "/api/tts/" + id,
    publicAudioUrl: publicBaseUrl ? `${publicBaseUrl}/api/tts/${id}` : `/api/tts/${id}`,
    dictId: dictId || null,
  };
}
