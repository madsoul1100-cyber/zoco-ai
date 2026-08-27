/**
 * Conversation engine: OpenRouter (preferred), OpenAI, then local keyword fallback.
 * Fast path: short spoken text + optional [END:disposition] tag. No JSON-mode round trip.
 */

import { detectLanguageFromText, detectRequestedLanguage, getLanguage } from "../languages.js";
import { getAiSettings } from "../store.js";
import { fallbackLlmConfig, llmHeaders, resolveLlmConfig, speakerGender } from "./providers.js";
import { openAiTools, runToolCall } from "./tools.js";

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

function compiledAgentInstructions(agent) {
  const sections = Array.isArray(agent?.instructionSections) ? agent.instructionSections : [];
  if (sections.length) {
    return sections
      .filter((section) => String(section?.title || "").trim() || String(section?.body || "").trim())
      .map((section) => {
        const title = String(section.title || "").trim();
        const body = String(section.body || "").trim();
        if (title && body) return `${title}\n${body}`;
        return title || body;
      })
      .join("\n\n")
      .trim();
  }
  return String(agent?.instructions || "").trim();
}

function workflowInstruction(agent) {
  const nodes = Array.isArray(agent?.workflow?.nodes) ? agent.workflow.nodes : [];
  if (!agent?.workflow?.enabled || !nodes.length) return "";
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const lines = nodes.map((node, index) => {
    const title = String(node?.title || `Stage ${index + 1}`).trim();
    const body = String(node?.body || "").trim();
    if (node.type === "condition") {
      const yes = byId[node.yes]?.title || "next";
      const no = byId[node.no]?.title || "end";
      return `${index + 1}. BRANCH “${title}”: if the customer matches “${node.match || "yes"}” go to ${yes}, else ${no}. ${body}`;
    }
    const next = node.next && byId[node.next] ? ` → then ${byId[node.next].title}` : "";
    return `${index + 1}. ${title}${body ? `: ${body}` : ""}${next}`;
  });
  return `Call flow — follow stages and branches. Do not say stage names out loud.\n${lines.join("\n")}`;
}

function languageInstruction(agent) {
  const lang = getLanguage(agent?.language);
  const gender = speakerGender(agent);
  const rich = Array.isArray(agent?.instructionSections) && agent.instructionSections.length > 0;
  const gendered = lang.code === "en-IN"
    ? ""
    : gender === "male"
      ? "You speak with a male voice. In Hindi and other gendered Indian languages use masculine first-person forms: करूंगा, रहा हूँ, गया. Never say करूंगी, रही, or गई."
      : "You speak with a female voice. In Hindi and other gendered Indian languages use feminine first-person forms: करूंगी, रही हूँ, गई. Never say करूंगा.";
  const settings = agent?.callSettings || {};
  const numbers = settings.indicNumbers
    ? "Speak numbers in Indic words in Hindi and other Indian languages. Example: 500 as paanch sau, not five hundred."
    : "";
  if (rich) {
    return [
      "Reply with spoken words only for the caller. No markdown, bullets, emojis, citations, URLs or JSON.",
      "Follow the Instructions below exactly for length, questions, punctuation and endings. They override any shorter default style.",
      "If the customer asks to talk in English, Hindi, or another allowed language, switch immediately and stay there until they switch again.",
      gendered,
      numbers,
    ].filter(Boolean).join(" ");
  }
  return [
    "Reply with spoken words only. No lists, markdown, emojis, question marks, or exclamation marks.",
    "Sound like a calm human on a phone: natural pacing, contractions when speaking English, one clear thought per turn.",
    "Indian TTS voices read ? and ! out loud as 'question mark' and 'exclamation point'. Never write those characters.",
    "Do not add [END:...] until the customer has clearly given the success information, after at least two real customer replies.",
    "If the customer transcript is noise, punctuation, 'exclamation point', or 'question mark', briefly ask them to repeat. Do not end the call.",
    "If the customer asks to talk in English, Hindi, or another language, switch immediately on this turn and stay in that language until they ask again.",
    gendered,
    numbers,
  ].filter(Boolean).join(" ");
}

function languageLock(agent) {
  const lang = getLanguage(agent?.language);
  if (lang.code === "en-IN") {
    return "LANGUAGE LOCK for this turn: speak natural Indian English only. Use Latin letters. Do not write Devanagari, Hindi, Telugu, or any other script. Do not say जी, बिल्कुल, कृपया, बताइए, or mix Hindi into this reply. If an earlier turn was in another language, switch now.";
  }
  return `LANGUAGE LOCK for this turn: speak ${lang.label} only, in the ${lang.native} script. Keep any [END:...] tag in ASCII English. Do not reply in English unless the customer asked for English.`;
}

export function buildModelMessages({ agent, history, userText, slots, knowledge }) {
  const rich = Array.isArray(agent?.instructionSections) && agent.instructionSections.length > 0;
  const voiceStream = Boolean(agent?._voiceStream);
  let compiled = compiledAgentInstructions(agent);
  if (voiceStream && compiled.length > 2000) {
    compiled = `${compiled.slice(0, 2000)}\n…(trimmed for voice latency — keep Opening/Pitch/Ending rules)`;
  }
  const system = [
    `You are ${agent.name}, on a live phone call.`,
    rich
      ? `Stay in character for this agent. Obey the Instructions section as the source of truth for role, flow, language, tools and endings.
Hard speech rules from the Instructions (never break these):
- Never say ధన్యవాదాలు. Use English "Thank you" only for genuine thanks, never for giving a name/district/year.
- Always speak the English words "Form 18". Never say ఫారం, ఫార్మ్ or ఫార్మే.
- Default to one short spoken sentence; two only when needed before one question.
- On refusal / not interested / wrong person / opt-out: speak exactly సరే అండి (Telugu), then end. Never mix Devanagari into that line.
- After a language switch, continue the Graduate MLC outbound pitch. Never ask generic how-can-I-help.
- When the active language is Hindi, speak only Devanagari Hindi until another language is requested (except Ending Telugu lines).`
      : `You work for the business in the use case. Sound like a real agency person, not a generic assistant. One or two short sentences. Never more than 25 words.`,
    languageInstruction(agent),
    `Use case: ${agent.useCase}. Goal: ${agent.successCriteria}.`,
    compiled
      ? `Instructions:\n${compiled}`
      : agent.persona
        ? `Persona: ${agent.persona}`
        : "",
    voiceStream ? "" : workflowInstruction(agent),
    !voiceStream && Array.isArray(agent.outputVariables) && agent.outputVariables.length
      ? `After the call you must be able to fill these output variables from what was said: ${agent.outputVariables.map((item) => `${item.key} (${item.dataType || "string"}): ${item.prompt || ""}`).join("; ")}`
      : "",
    Array.isArray(agent.customTools) && agent.customTools.length
      ? `You may call HTTP tools when you need live data. Do not mention tool names. After a tool result, speak a short natural update.`
      : "",
    knowledge ? `Use this knowledge base only when the customer asks something factual. Never read it out as a list. Knowledge:\n${knowledge}` : "",
    slots && Object.keys(slots).length ? `Known details: ${JSON.stringify(slots)}` : "",
    voiceStream
      ? "VOICE STREAM LATENCY: Reply in ONE short spoken sentence only (max 14 words). Ask at most one question. Do not invent the customer name — use Known details only. If name is unknown, say గారు / sir without a wrong name."
      : "",
    `Reply with spoken words only.`,
    rich
      ? `When the Instructions say to end the call, speak the required closing line first, then add [END:not_interested], [END:success], [END:callback_requested], or [END:do_not_call] as appropriate.`
      : `If and only if the call should end after a real outcome, add a tag at the very end: [END:qualified], [END:success], [END:callback_requested], or [END:not_interested].`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const prior = (history || [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(voiceStream ? -8 : -12)
    .map((m) => ({ role: m.role, content: m.text }));

  const last = prior.at(-1);
  const messages = [{ role: "system", content: system }, ...prior];
  if (!last || last.role !== "user" || last.content !== userText) {
    messages.push({ role: "user", content: userText });
  }
  if (!rich) {
    messages.push({ role: "system", content: languageLock(agent) });
  } else {
    const lang = getLanguage(agent?.language);
    const code = lang.code;
    if (code === "hi-IN") {
      messages.push({
        role: "system",
        content:
          "LANGUAGE LOCK for this turn: speak natural Hindi only in Devanagari. Do not mix Telugu script into conversational lines. Continue the Graduate MLC outbound pitch (recording / separate list / graduation / Form 18 as needed). Never ask generic how can I help. Exception: if Ending applies, speak the exact Telugu line సరే అండి (or the other Ending Telugu lines) then [END:...]. Prefer the Instructions over any generic brevity rule.",
      });
    } else if (code === "en-IN") {
      messages.push({ role: "system", content: languageLock(agent) });
    } else {
      messages.push({
        role: "system",
        content: `LANGUAGE LOCK for this turn: speak ${lang.label} primarily in the ${lang.native} script unless the caller clearly switched. Keep [END:...] tags in ASCII. Prefer the Instructions over any generic brevity rule. Ending lines must stay exact Telugu as written (సరే అండి).`,
      });
    }
  }
  return messages;
}

function sanitizeSpoken(text) {
  return String(text || "")
    .replace(/ధన్యవాదాలు\.?/g, "")
    .replace(/అప్లికేషన్\s*ఫారం|అప్లికేషన్\s*ఫార్మ్|ఫార్మే|ఫార్మ్|ఫారం/g, "Form 18")
    .replace(/\bForm\s*18\s*Form\s*18\b/gi, "Form 18")
    // Fix common Devanagari/Telugu corruption on required endings.
    .replace(/सరే\s*అండి\.?/g, "సరే అండి.")
    .replace(/सारे\s*अंडी\.?|सरे\s*अंडी\.?|सरे\s*अन्डि\.?/gi, "సరే అండి.")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}

export function parseSpoken(content) {
  if (!content) return { text: "", endCall: false, disposition: null };
  let raw = String(content).replace(/```json|```/g, "").trim();
  const end = raw.match(/\[END:([a-z_]+)\]/i);
  raw = raw.replace(/\[END:[a-z_]+\]/gi, "").trim();
  let parsed;
  if (raw.startsWith("{")) {
    try {
      const json = JSON.parse(raw);
      parsed = {
        text: sanitizeSpoken(String(json.text || "").trim()),
        endCall: Boolean(json.endCall || end),
        disposition: json.disposition || end?.[1]?.toLowerCase() || null,
      };
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    parsed = {
      text: sanitizeSpoken(raw),
      endCall: Boolean(end),
      disposition: end?.[1]?.toLowerCase() || null,
    };
  }
  return enforceClosingLine(parsed);
}

function enforceClosingLine(parsed) {
  const disposition = parsed?.disposition;
  if (!parsed?.endCall || !disposition) return parsed;
  if (disposition === "not_interested" || disposition === "wrong_person") {
    return { ...parsed, text: "సరే అండి." };
  }
  if (disposition === "do_not_call") {
    return { ...parsed, text: "సరే, మళ్లీ call చేయవద్దన్న మీ request నమోదు చేస్తున్నాను." };
  }
  if (disposition === "callback_requested") {
    const text = String(parsed.text || "").trim();
    if (!text || /सరే|सारे|सरे|ठीक है/.test(text)) {
      return { ...parsed, text: "సరే, మీరు చెప్పిన time note చేశాను." };
    }
  }
  return parsed;
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
  const settings = agent?.callSettings || {};
  const current = call?.language || agent?.language || "en-IN";
  const requested = detectRequestedLanguage(userText);
  if (settings.switchLanguage === false && !requested) {
    if (call) call.language = current;
    return current;
  }
  const detected = requested || (settings.autoDetectLanguage === false
    ? current
    : detectLanguageFromText(userText, current));
  const allowed = settings.allowedLanguages;
  let next = detected;
  if (!requested && Array.isArray(allowed) && allowed.length && !allowed.includes(detected)) {
    next = current;
  }
  if (call) call.language = next;
  return next;
}

function withSpokenLanguage(agent, call) {
  return { ...agent, language: call?.language || agent?.language || "en-IN" };
}

export async function generateReply({ agent, call, userText, knowledge = "", knowledgeFn }) {
  followCustomerLanguage(call, agent, userText);
  const speaking = withSpokenLanguage(agent, call);
  const history = call.messages || [];
  const slots = { ...(call.gathered || {}), ...extractSlots(history, userText) };
  const settings = await getAiSettings();
  let llm = resolveLlmConfig(speaking, settings);

  if (llm) {
    try {
      const result = await completeWithTools({
        agent: speaking,
        call,
        history,
        userText,
        slots,
        llm,
        knowledge,
        knowledgeFn,
      });
      return { ...guardEarlyHangup(result, call), slots, provider: llm.provider, model: llm.model };
    } catch (error) {
      console.warn(`${llm.provider} fallback:`, error.message);
      const backup = llm.provider === "openrouter" ? null : fallbackLlmConfig(settings);
      if (backup) {
        try {
          const result = await completeWithTools({
            agent: speaking,
            call,
            history,
            userText,
            slots,
            llm: backup,
            knowledge,
            knowledgeFn,
          });
          return { ...guardEarlyHangup(result, call), slots, provider: backup.provider, model: backup.model };
        } catch (retryError) {
          console.warn(`${backup.provider} fallback:`, retryError.message);
          return {
            ...localReply({ agent: speaking, history, userText, slots }),
            provider: "local",
            model: null,
            llmError: retryError.message,
          };
        }
      }
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

async function completeWithTools({ agent, call, history, userText, slots, llm, knowledge, knowledgeFn }) {
  const tools = openAiTools(agent);
  const messages = buildModelMessages({ agent, history, userText, slots, knowledge });
  let data = await chatCompletion(llm, {
    agent,
    messages,
    tools,
    stream: false,
  });
  let extra = "";
  let transfer = "";
  let forcedEnd = null;
  for (let step = 0; step < 4; step += 1) {
    const calls = data.choices?.[0]?.message?.tool_calls || [];
    if (!calls.length) break;
    messages.push(data.choices[0].message);
    for (const item of calls) {
      const name = item.function?.name || "";
      let args = {};
      try {
        args = JSON.parse(item.function?.arguments || "{}");
      } catch {
        args = {};
      }
      const ran = await runToolCall({
        name,
        args,
        agent,
        call,
        slots,
        knowledgeFn,
      });
      if (ran.transfer) transfer = ran.transfer;
      if (ran.endCall) forcedEnd = ran.disposition || "success";
      if (ran.say) extra = ran.say;
      messages.push({
        role: "tool",
        tool_call_id: item.id,
        content: ran.result || ran.say || JSON.stringify(ran),
      });
    }
    data = await chatCompletion(llm, { agent, messages, tools, stream: false });
  }
  const content = data.choices?.[0]?.message?.content || extra;
  let parsed = parseSpoken(content);
  if (forcedEnd) {
    parsed.endCall = true;
    parsed.disposition = forcedEnd;
    if (!parsed.text) {
      parsed.text = extra || defaultEndLine(forcedEnd, agent);
    }
    parsed = enforceClosingLine(parsed);
  }
  if (transfer) parsed.transfer = transfer;
  return parsed;
}

function cannedVoiceTurn({ agent, history, userText, slots }) {
  const usersBefore = (history || []).filter((m) => m.role === "user").length;
  // history already includes the just-attached user turn in stream endpoint
  const turn = Math.max(0, usersBefore);
  const text = String(userText || "").trim();
  const lower = text.toLowerCase();
  const name = String(slots?.customer_name || slots?.name || "").trim();
  const honorific = name ? `${name} గారు` : "గారు";
  // Allow canned for first user reply after greeting (turn === 1 once attached).
  if (turn > 2) return null;

  if (/(not interested|no thanks|don't call|do not call|వద్దు|అక్కర్లేదు|interested కాదు)/i.test(lower)
    || /नहीं|रुचि नहीं|मत करो/.test(text)) {
    return { text: "సరే అండి.", endCall: true, disposition: "not_interested" };
  }
  if (/^(yes|yeah|yep|ok|okay|sure|haan|हां|जी|అవును|చెప్పండి|మాట్లాడొచ్చు|మాట్లాడవచ్చు)\b/i.test(text)
    || /^(yes|ok|okay|sure|అవును)([,.!\s]|$)/i.test(text)) {
    const lang = getLanguage(agent?.language).code;
    if (lang === "hi-IN") {
      return {
        text: name
          ? `${name} जी, क्वालिटी के लिए यह कॉल रिकॉर्ड हो रही है। आपकी graduation किस साल पूरी हुई?`
          : "क्वालिटी के लिए यह कॉल रिकॉर्ड हो रही है। आपकी graduation किस साल पूरी हुई?",
        endCall: false,
        disposition: null,
      };
    }
    if (lang === "en-IN") {
      return {
        text: name
          ? `${name}, this call is recorded for quality. Which year did you complete your graduation?`
          : "This call is recorded for quality. Which year did you complete your graduation?",
        endCall: false,
        disposition: null,
      };
    }
    return {
      text: `${honorific}, quality కోసం ఈ call record అవుతోంది. మీ graduation ఏ yearలో complete అయింది?`,
      endCall: false,
      disposition: null,
    };
  }
  return null;
}

function defaultEndLine(disposition, agent) {
  // Priya/MLC endings stay Telugu exactly as written in Instructions, even mid-Hindi call.
  const rich = Array.isArray(agent?.instructionSections) && agent.instructionSections.length > 0;
  if (rich || getLanguage(agent?.language).code === "te-IN") {
    if (disposition === "do_not_call") return "సరే, మళ్లీ call చేయవద్దన్న మీ request నమోదు చేస్తున్నాను.";
    if (disposition === "callback_requested") return "సరే, మీరు చెప్పిన time note చేశాను.";
    return "సరే అండి.";
  }
  const lang = getLanguage(agent?.language).code;
  if (lang === "hi-IN") {
    if (disposition === "do_not_call") return "ठीक है, दोबारा कॉल नहीं करेंगे।";
    return "ठीक है।";
  }
  if (disposition === "do_not_call") return "Okay, I will note not to call again.";
  return "Okay.";
}

async function chatCompletion(llm, { agent, messages, tools, stream, maxTokens }) {
  const rich = Array.isArray(agent?.instructionSections) && agent.instructionSections.length;
  const defaultMax = stream
    ? rich ? 70 : 55
    : rich ? 220 : getLanguage(agent?.language).code === "en-IN" ? 90 : 140;
  const payload = {
    model: llm.model,
    temperature: Number(agent?.callSettings?.temperature ?? 0.35),
    max_tokens: Number(maxTokens) || defaultMax,
    stream: Boolean(stream),
    messages,
  };
  if (tools?.length && llm.provider !== "sarvam") payload.tools = tools;
  const response = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(llm),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`${llm.provider} ${response.status}: ${raw.slice(0, 400)}`);
  }
  if (stream) return response;
  return response.json();
}

export async function* streamModelTokens({ agent, history, userText, slots, llm, knowledge = "" }) {
  const response = await chatCompletion(llm, {
    agent,
    messages: buildModelMessages({ agent, history, userText, slots, knowledge }),
    stream: true,
  });
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

/**
 * Stream a voice-oriented reply token-by-token (no mid-turn tools — keeps TTFA low).
 * Falls back to the full tool-capable path if streaming fails.
 */
export async function streamReply({ agent, call, userText, knowledge = "", onToken }) {
  followCustomerLanguage(call, agent, userText);
  const speaking = { ...withSpokenLanguage(agent, call), _voiceStream: true };
  const history = call.messages || [];
  const customerName = String(
    call?.gathered?.customer_name
      || call?.customer?.customer_name
      || call?.customer?.name
      || ""
  ).trim();
  const slots = {
    ...(call.gathered || {}),
    ...extractSlots(history, userText),
    ...(customerName && !/^(guest|test customer|caller)$/i.test(customerName)
      ? { customer_name: customerName, name: customerName }
      : {}),
  };

  // Hybrid voice: known first-turn affirm/refuse without waiting on the LLM.
  const canned = cannedVoiceTurn({ agent: speaking, history, userText, slots });
  if (canned) {
    if (canned.text) onToken?.(canned.text);
    return { ...canned, slots, provider: "canned", model: null };
  }

  const settings = await getAiSettings();
  const llm = resolveLlmConfig(speaking, settings);

  if (!llm) {
    const local = localReply({ agent: speaking, history, userText, slots });
    if (local.text) onToken?.(local.text);
    return { ...local, slots, provider: "local", model: null };
  }

  try {
    let full = "";
    for await (const token of streamModelTokens({
      agent: speaking,
      history,
      userText,
      slots,
      llm,
      knowledge,
    })) {
      full += token;
      onToken?.(token);
    }
    if (!full.trim()) {
      const local = localReply({ agent: speaking, history, userText, slots });
      if (local.text) onToken?.(local.text);
      return { ...local, slots, provider: "local", model: null };
    }
    return {
      ...guardEarlyHangup(parseSpoken(full), call),
      slots,
      provider: llm.provider,
      model: llm.model,
    };
  } catch (error) {
    console.warn(`${llm.provider} stream fallback:`, error.message);
    try {
      const result = await completeWithTools({
        agent: speaking,
        call,
        history,
        userText,
        slots,
        llm,
        knowledge,
      });
      if (result.text) onToken?.(result.text);
      return { ...guardEarlyHangup(result, call), slots, provider: llm.provider, model: llm.model };
    } catch (retryError) {
      const local = localReply({ agent: speaking, history, userText, slots });
      if (local.text) onToken?.(local.text);
      return {
        ...local,
        slots,
        provider: "local",
        model: null,
        llmError: retryError.message || error.message,
      };
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
