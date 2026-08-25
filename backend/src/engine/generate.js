import { normalizeLanguage } from "../languages.js";
import { llmHeaders, resolveLlm } from "./conversation.js";

const CATEGORIES = ["appointments", "collections", "reminder", "recovery", "lead-qualification", "support"];
const PATCH_FIELDS = [
  "name",
  "direction",
  "category",
  "useCase",
  "persona",
  "instructions",
  "greeting",
  "qualifyPrompt",
  "closingPrompt",
  "successPrompt",
  "successCriteria",
  "defaultSuccessDisposition",
  "language",
];

export function heuristicAgent(prompt) {
  const text = String(prompt || "").toLowerCase();
  const inbound = /\b(answer|inbound|incoming|helpdesk|support|receive|ivr)\b/.test(text);
  const category =
    CATEGORIES.find((item) => text.includes(item.replace("-", " ")) || text.includes(item)) ||
    (/\b(emi|collect|overdue|payment|dues)\b/.test(text) && "collections") ||
    (/\b(remind|follow.?up|confirm)\b/.test(text) && "reminder") ||
    (/\b(cart|abandon|recover|nudge)\b/.test(text) && "recovery") ||
    (/\b(lead|qualif|demo|sales|discovery)\b/.test(text) && "lead-qualification") ||
    (/\b(appoint|book|reschedul|slot)\b/.test(text) && "appointments") ||
    (inbound ? "support" : "lead-qualification");

  const name =
    category === "appointments"
      ? "Appointment desk"
      : category === "collections"
        ? "Collections agent"
        : category === "reminder"
          ? "Reminder agent"
          : category === "recovery"
            ? "Recovery agent"
            : category === "support"
              ? "Support concierge"
              : "Sales discovery";

  const direction = inbound || category === "support" ? "inbound" : "outbound";
  return {
    name,
    direction,
    category,
    useCase: String(prompt).trim(),
    persona: "Warm, concise, professional. Sounds like a real person at the company, never a script reader.",
    greeting:
      direction === "inbound"
        ? `Thank you for calling. This is ${name}. How can I help you today?`
        : `Hi, this is ${name} from Zoco. ${String(prompt).trim().slice(0, 80)}. Is now a good time?`,
    qualifyPrompt: "I want to make this easy. Should we complete this now, or is another time better?",
    closingPrompt: "I can close this out, book the next step, or call you back.",
    successPrompt: "All set. I have logged this and we are done on this call.",
    successCriteria: `Mark the call successful when this is done: ${String(prompt).trim()}`,
    defaultSuccessDisposition: category === "appointments" ? "booked" : category === "lead-qualification" ? "qualified" : "success",
    language: "en-IN",
    voice: "Serena",
    knowledgeBaseIds: [],
    status: "draft",
    version: 1,
    instructions: "",
    variables: [],
    llmProvider: "",
    llmModel: "",
    ttsProvider: "browser",
    ttsVoice: "",
    ttsModel: "",
  };
}

export async function generateAgentFromPrompt(prompt) {
  const fallback = heuristicAgent(prompt);
  const llm = await resolveLlm({});
  if (!llm) return fallback;

  const response = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(llm),
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.3,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content:
            "You design voice agents for Indian businesses. Reply with JSON only, no markdown. Fields: name, direction (inbound|outbound), category (appointments|collections|reminder|recovery|lead-qualification|support), useCase, persona, greeting, qualifyPrompt, closingPrompt, successPrompt, successCriteria, defaultSuccessDisposition (success|qualified|booked), language (BCP-47 like en-IN or hi-IN).",
        },
        {
          role: "user",
          content: `Create a voice agent for: ${prompt}`,
        },
      ],
    }),
  });

  if (!response.ok) return fallback;
  const data = await response.json();
  const raw = String(data.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      direction: parsed.direction === "inbound" ? "inbound" : "outbound",
      category: CATEGORIES.includes(parsed.category) ? parsed.category : fallback.category,
      knowledgeBaseIds: [],
      status: "draft",
      language: parsed.language || "en-IN",
    };
  } catch {
    return fallback;
  }
}

function extractJson(raw) {
  const text = String(raw || "").replace(/```json|```/g, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  return JSON.parse(text.slice(start, end + 1));
}

function sanitizePatch(patch = {}) {
  const next = {};
  for (const key of PATCH_FIELDS) {
    if (patch[key] == null || patch[key] === "") continue;
    next[key] = patch[key];
  }
  if (next.direction && next.direction !== "inbound") next.direction = "outbound";
  if (next.category && !CATEGORIES.includes(next.category)) delete next.category;
  if (next.language) next.language = normalizeLanguage(next.language);
  if (next.instructions && !next.persona) next.persona = next.instructions;
  if (next.persona && !next.instructions) next.instructions = next.persona;
  return next;
}

function heuristicRevise(agent, prompt) {
  const text = String(prompt || "").toLowerCase();
  const patch = {};
  if (/\bhindi\b/.test(text)) patch.language = "hi-IN";
  if (/\btamil\b/.test(text)) patch.language = "ta-IN";
  if (/\btelugu\b/.test(text)) patch.language = "te-IN";
  if (/\bbengali\b/.test(text)) patch.language = "bn-IN";
  if (/\bmarathi\b/.test(text)) patch.language = "mr-IN";
  if (/\bgujarati\b/.test(text)) patch.language = "gu-IN";
  if (/\bkannada\b/.test(text)) patch.language = "kn-IN";
  if (/\bmalayalam\b/.test(text)) patch.language = "ml-IN";
  if (/\bpunjabi\b/.test(text)) patch.language = "pa-IN";
  if (/\benglish\b/.test(text)) patch.language = "en-IN";
  if (/\binbound\b/.test(text)) patch.direction = "inbound";
  if (/\boutbound\b/.test(text)) patch.direction = "outbound";
  const rename = String(prompt).match(/rename(?: this agent| it| the agent)?(?: to)?\s+["']?([^"'\n.]+)["']?/i);
  if (rename) patch.name = rename[1].trim();
  const changed = Object.keys(patch);
  return {
    reply: changed.length
      ? `Updated ${changed.join(", ")}. Review the draft, then click Finish update.`
      : "I can rename the agent, switch language, rewrite the greeting, or tighten instructions. Try “Switch the greeting to Hindi.”",
    patch: sanitizePatch(patch),
  };
}

export async function reviseAgentFromPrompt(agent, prompt) {
  const fallback = heuristicRevise(agent, prompt);
  const llm = await resolveLlm(agent || {});
  if (!llm) return fallback;

  const snapshot = {
    name: agent.name,
    direction: agent.direction,
    language: agent.language,
    greeting: agent.greeting,
    persona: agent.persona,
    instructions: agent.instructions || agent.persona,
    useCase: agent.useCase,
    successCriteria: agent.successCriteria,
  };

  const response = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(llm),
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content:
            "You edit voice agents for Indian businesses. Reply with JSON only, no markdown. Shape: {\"reply\":\"short confirmation of what you changed\",\"patch\":{...only changed fields}}. Patch keys may include name, direction (inbound|outbound), language (BCP-47 like hi-IN), greeting, instructions, persona, useCase, successCriteria. Keep greeting spoken and short. Keep {{variable}} placeholders. If the user asks to review, put concrete edits in patch and explain them in reply. Never include unchanged fields.",
        },
        {
          role: "user",
          content: `Current agent:\n${JSON.stringify(snapshot)}\n\nUser request:\n${prompt}`,
        },
      ],
    }),
  });

  if (!response.ok) return fallback;
  const data = await response.json();
  try {
    const parsed = extractJson(data.choices?.[0]?.message?.content);
    const patch = sanitizePatch(parsed.patch || parsed);
    return {
      reply: String(parsed.reply || fallback.reply),
      patch,
    };
  } catch {
    return fallback;
  }
}
