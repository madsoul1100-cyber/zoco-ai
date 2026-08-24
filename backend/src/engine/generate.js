import { llmHeaders, resolveLlm } from "./conversation.js";

const CATEGORIES = ["appointments", "collections", "reminder", "recovery", "lead-qualification", "support"];

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
