import { Blob } from "node:buffer";
import { getAiSettings } from "../store.js";
import { mergedKeys, sarvamTtsLanguage } from "./providers.js";

export async function sttReady() {
  const settings = await getAiSettings();
  return Boolean(mergedKeys(settings).sarvam);
}

export async function transcribeAudio(buffer, { language = "en-IN", mime = "audio/webm", filename = "speech.webm" } = {}) {
  const settings = await getAiSettings();
  const key = mergedKeys(settings).sarvam;
  if (!key || !buffer?.length) return "";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  form.append("language_code", sarvamTtsLanguage(language));
  form.append("model", "saarika:v2.5");
  const response = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`stt ${response.status}: ${raw.slice(0, 240)}`);
  try {
    const data = JSON.parse(raw);
    return String(data.transcript || data.text || "").trim();
  } catch {
    return raw.trim();
  }
}

export async function transcribeFromUrl(url, { language, authHeader } = {}) {
  if (!url) return "";
  const headers = authHeader ? { Authorization: authHeader } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error("Could not download recording for STT");
  const buffer = Buffer.from(await response.arrayBuffer());
  const mime = response.headers.get("content-type") || "audio/wav";
  const ext = mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : mime.includes("webm") ? "webm" : "wav";
  return transcribeAudio(buffer, { language, mime, filename: `utterance.${ext}` });
}
