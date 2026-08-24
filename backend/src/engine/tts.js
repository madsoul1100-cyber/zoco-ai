import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { llmHeaders, resolveTtsConfig, sarvamTtsLanguage } from "./providers.js";
import { spokenForTts } from "../languages.js";
import { DATA_DIR } from "../store.js";

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

async function synthesizeSarvam({ text, language, voice, model, apiKey }) {
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: sarvamTtsLanguage(language),
      speaker: voice || "shubh",
      model: model || "bulbul:v3",
      pace: 1.0,
    }),
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

async function synthesizeOpenAi({ text, voice, model, apiKey }) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: llmHeaders({ provider: "openai", apiKey }),
    body: JSON.stringify({
      model: model || "tts-1",
      voice: voice || "nova",
      input: text,
      response_format: "mp3",
    }),
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`OpenAI TTS ${response.status}: ${raw.slice(0, 240)}`);
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), ext: "mp3" };
}

export async function synthesizeSpeech({ agent, text, settings, publicBaseUrl = "" }) {
  const spoken = spokenForTts(text).slice(0, 1400);
  if (!spoken) return null;
  const tts = resolveTtsConfig(agent, settings);
  if (!tts.ready || tts.provider === "browser") {
    if (tts.provider !== "browser") {
      throw new Error(`Add a ${tts.provider} API key in Settings to use this voice.`);
    }
    return { provider: "browser" };
  }
  const id = clipId({
    provider: tts.provider,
    model: tts.model,
    voice: tts.voice,
    language: tts.language,
    text: spoken,
  });
  const existing = await getTtsClip(id);
  if (!existing) {
    const made =
      tts.provider === "sarvam"
        ? await synthesizeSarvam({
            text: spoken,
            language: tts.language,
            voice: tts.voice,
            model: tts.model,
            apiKey: tts.apiKey,
          })
        : await synthesizeOpenAi({
            text: spoken,
            voice: tts.voice,
            model: tts.model,
            apiKey: tts.apiKey,
          });
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
  };
}
