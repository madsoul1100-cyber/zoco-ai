/**
 * Conversation engine: OpenRouter (preferred), OpenAI, then local keyword fallback.
 * Fast path: short spoken text + optional [END:disposition] tag. No JSON-mode round trip.
 */

import { detectLanguageFromText, getLanguage } from "../languages.js";
import { getAiSettings } from "../store.js";
import { llmHeaders, resolveLlmConfig, speakerGender } from "./providers.js";

const SLOT_PATTERNS = [
  { key: "name", re: /(?:i am|i'm|this is|my name is)\s+([A-Za-z][A-Za-z\s]{1,40})/i },
  { key: "callbackTime", re: /(?:call(?: me)? back|recall|tomorrow|evening|morning|after)\s*([^.!?]{0,40})/i },
  { key: "city", re: /(?:in|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/ },
];

export function llmConfig() {
  return resolveLlmConfig({}, { keys: {} });
}

export { llmHeaders };

export async function resolveLlm(agent) {
  const settings = await getAiSettings();
  return resolveLlmConfig(agent, settings);
}

function languageInstruction(agent) {
  const lang = getLanguage(agent?.language);
  const gender = speakerGender(agent);
  const gendered = gender === "male"
    ? "You speak with a male voice. In Hindi and other gendered Indian languages use masculine first-person forms: करूंगा, रहा हूँ, गया. Never say करूंगी, रही, or गई."
    : "You speak with a female voice. In Hindi and other gendered Indian languages use feminine first-person forms: करूंगी, रही हूँ, गई. Never say करूंगा.";
  const shared = [
    "Reply with spoken words only. No lists, markdown, emojis, question marks, or exclamation marks.",
    "Indian TTS voices read ? and ! out loud as 'question mark' and 'exclamation point'. Never write those characters.",
    "Do not add [END:...] until the customer has clearly given the success information, after at least two real customer replies.",
    "If the customer transcript is noise, punctuation, 'exclamation point', or 'question mark', briefly ask them to repeat. Do not end the call.",
    "If the customer asks to talk in English, Hindi, or another language, switch immediately on this turn and stay in that language until they ask again.",
    "Do not keep the agent's default language after the customer asked to change. English mixed into a Hindi call is a switch when they asked for English.",
    gendered,
  ].join(" ");
  if (lang.code === "en-IN") {
    return `This turn, speak natural Indian English. ${shared}`;
  }
  return `This turn, speak ${lang.label} (${lang.native}) in the native script. Keep any [END:...] tag in ASCII English. ${shared}`;
}

export function buildModelMessages({ agent, history, userText, slots, knowledge }) {
  const system = [
    `You are ${agent.name}, on a live phone call for Zoco. The other person is the customer, not you.`,
    `You work for the business in the use case. You are calling the customer about that service — for example a travel desk confirming a flight.`,
    `Sound like a real agency person, not a generic assistant. One or two short sentences. Never more than 25 words.`,
    languageInstruction(agent),
    `Use case: ${agent.useCase}. Goal: ${agent.successCriteria}. The goal is what you work toward, not a reason to hang up on the first turn.`,
    agent.persona ? `Persona: ${agent.persona}` : "",
    knowledge ? `Use this knowledge base only when the customer asks something factual. Never read it out as a list. Knowledge:\n${knowledge}` : "",
    slots && Object.keys(slots).length ? `Known details: ${JSON.stringify(slots)}` : "",
    `Reply with spoken words only.`,
    `If and only if the call should end after a real outcome, add a tag at the very end: [END:qualified], [END:success], [END:callback_requested], or [END:not_interested].`,
  ]
    .filter(Boolean)
    .join(" ");

  const prior = (history || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.text }));

  const last = prior.at(-1);
  const messages = [{ role: "system", content: system }, ...prior];
  if (!last || last.role !== "user" || last.content !== userText) {
    messages.push({ role: "user", content: userText });
  }
  return messages;
}

export function parseSpoken(content) {
  if (!content) return { text: "", endCall: false, disposition: null };
  let raw = String(content).replace(/```json|```/g, "").trim();
  const end = raw.match(/\[END:([a-z_]+)\]/i);
  raw = raw.replace(/\[END:[a-z_]+\]/gi, "").trim();
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      return {
        text: String(parsed.text || "").trim(),
        endCall: Boolean(parsed.endCall || end),
        disposition: parsed.disposition || end?.[1]?.toLowerCase() || null,
      };
    } catch {
      /* spoken text */
    }
  }
  return {
    text: raw,
    endCall: Boolean(end),
    disposition: end?.[1]?.toLowerCase() || null,
  };
}

export function guardEarlyHangup(parsed, call) {
  const userTurns = (call?.messages || []).filter((m) => m.role === "user").length;
  const allowed = ["not_interested", "do_not_call"];
  if (parsed.endCall && userTurns < 2 && !allowed.includes(parsed.disposition)) {
    return { ...parsed, endCall: false, disposition: null };
  }
  return parsed;
}

export function followCustomerLanguage(call, agent, userText) {
  const current = call?.language || agent?.language || "en-IN";
  const detected = detectLanguageFromText(userText, current);
  if (call) call.language = detected;
  return detected;
}

function withSpokenLanguage(agent, call) {
  return { ...agent, language: call?.language || agent?.language || "en-IN" };
}

export async function generateReply({ agent, call, userText, knowledge = "" }) {
  followCustomerLanguage(call, agent, userText);
  const speaking = withSpokenLanguage(agent, call);
  const history = call.messages || [];
  const slots = { ...(call.gathered || {}), ...extractSlots(history, userText) };
  const llm = await resolveLlm(speaking);

  if (llm) {
    try {
      let full = "";
      for await (const token of streamModelTokens({ agent: speaking, history, userText, slots, llm, knowledge })) {
        full += token;
      }
      return { ...guardEarlyHangup(parseSpoken(full), call), slots, provider: llm.provider, model: llm.model };
    } catch (error) {
      console.warn(`${llm.provider} fallback:`, error.message);
      return {
        ...localReply({ agent: speaking, history, userText, slots }),
        provider: "local",
        model: null,
        llmError: error.message,
      };
    }
  }

  return { ...localReply({ agent: speaking, history, userText, slots }), provider: "local", model: null };
}

export async function* streamModelTokens({ agent, history, userText, slots, llm, knowledge = "" }) {
  const response = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(llm),
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.35,
      max_tokens: getLanguage(agent?.language).code === "en-IN" ? 90 : 140,
      stream: true,
      messages: buildModelMessages({ agent, history, userText, slots, knowledge }),
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`${llm.provider} ${response.status}: ${raw.slice(0, 400)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        /* ignore keepalives */
      }
    }
  }
}

function extractSlots(history, userText) {
  const blob = [...history.map((m) => m.text), userText].join(" \n ");
  const slots = {};
  for (const { key, re } of SLOT_PATTERNS) {
    const match = blob.match(re);
    if (match?.[1]) slots[key] = match[1].trim().replace(/\s+/g, " ");
  }
  return slots;
}

export { extractSlots };

function localReply({ agent, history, userText, slots }) {
  const text = userText.toLowerCase();
  const turn = history.filter((m) => m.role === "user").length;
  const name = slots.name || agent.name || "there";

  if (/(not interested|no thanks|stop|don't call|do not call)/.test(text)) {
    return close("No problem. I will close this here. Take care.", "not_interested", slots);
  }
  if (/(do not call|dnc|remove me)/.test(text)) {
    return close("Understood. I will not call this number again.", "do_not_call", slots);
  }
  if (/(call back|later|busy right now|in a meeting|not a good time)/.test(text)) {
    return close("Sure. I will call you back later. Thanks.", "callback_requested", slots);
  }
  if (/(book|confirm|schedule|let's do it|lets do it)/.test(text)) {
    return close(agent.successPrompt || `Lovely. I will mark this as done, ${name}.`, agent.defaultSuccessDisposition || "success", slots);
  }
  if (/(bye|that's all|hang up|end call)/.test(text)) {
    return close("Thanks for your time. Bye.", turn >= 2 ? "success" : "dropped", slots);
  }
  if (turn <= 1) {
    return { text: agent.greeting || "Hi, is now a good time for a quick chat?", endCall: false, disposition: null, slots };
  }
  return { text: "Got it. Would you like to continue, or should I call back later?", endCall: false, disposition: null, slots };
}

function close(text, disposition, slots) {
  return { text, endCall: true, disposition, slots };
}
