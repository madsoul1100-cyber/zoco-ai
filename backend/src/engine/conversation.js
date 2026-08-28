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

function voiceAgentInstructions(agent) {
  const sections = Array.isArray(agent?.instructionSections) ? agent.instructionSections : [];
  if (!sections.length) return compiledAgentInstructions(agent).slice(0, 5500);
  const priorities = new Set([
    "Priority on every caller turn",
    "Voice, emotion and spoken shape",
    "Language continuity",
    "Configured personalized greeting",
    "Opening interruption repair",
    "Objection handling",
    "Speech normalization",
    "Repair",
    "Ending",
  ]);
  return sections
    .filter((section) => priorities.has(String(section?.title || "").trim()))
    .map((section) => {
      const title = String(section.title || "").trim();
      const limits = {
        "Priority on every caller turn": 1500,
        "Language continuity": 1700,
        "Ending": 1700,
      };
      return `${title}\n${String(section.body || "").slice(0, limits[title] || 900)}`;
    })
    .join("\n\n")
    .slice(0, 9000);
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
  const compiled = voiceStream ? voiceAgentInstructions(agent) : compiledAgentInstructions(agent);
  const system = [
    `You are ${agent.name}, on a live phone call.`,
    rich
      ? `Stay in character for this agent. Obey the Instructions section as the source of truth for role, flow, language, tools and endings.
Hard speech rules from the Instructions (never break these):
- Never say ధన్యవాదాలు. Use English "Thank you" only for genuine thanks, never for giving a name/district/year.
- Always speak the English words "Form 18". Never say ఫారం, ఫార్మ్ or ఫార్మే.
- Default to one short spoken sentence; two only when needed before one question.
- On refusal / not interested / out-of-area / wrong person / opt-out: acknowledge what they said, speak a short closing in the ACTIVE language, then end with the correct [END:...] tag.
- Never mark wrong_person unless they clearly say a different person answered or the number is wrong.
- If they live outside the constituency or say this is not for them, end as not_interested — do not keep pitching.
- After a language switch, do not repeat the introduction. Briefly confirm the language, explain the Graduate MLC purpose, and ask permission.
- When the active language is Hindi, speak only Devanagari Hindi until another language is requested.
- In Hindi, keep normal Indian English terms in Latin script: Graduate MLC, voter registration, Form 18, quality, WhatsApp. Never transliterate them as ग्रेजुएट, एमएलसी, वोटर, रजिस्ट्रेशन, फॉर्म, क्वालिटी.
- When the active language is English, speak natural Indian English only until another language is requested.
- Never invent DOB, KYC, bank, or address-collection questions — stay on Graduate MLC awareness only.`
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
      ? "VOICE STREAM: At most TWO short spoken sentences. Complete your point in this turn — never stop at only okay / ठीक है / जी हाँ / हाँ. After a language switch, confirm the language AND say why you called (Graduate MLC) and ask for ~30 seconds in the SAME turn. If ending, close fully then [END:...]. If continuing, finish with one clear question."
      : "",
    `LISTEN FIRST (hard rule): The customer's latest message is the only thing you must answer on this turn. If they ask who you are, why you called, what this is about, what you want to say next, or ask to change language, answer that clearly before any script question (graduation year, Form 18, district, etc.). Never ignore their words to push the outbound pitch. Never invent that they agreed to something they did not say.`,
    `COMPLETE THE TURN (hard rule): Do not leave a dangling acknowledgement. Every reply must either (1) fully close the call with the correct ending line + [END:...], or (2) deliver the next useful point and end with one question. Never say only “okay / ठीक है / धन्यवाद” and wait.`,
    `SOUND HUMAN (hard rule): Speak like a real person on a phone — warm, brief, conversational. Keep natural punctuation (?, !, commas, ।) so TTS can breathe and ask questions with real intonation. Avoid stiff IVR phrasing.`,
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
          "LANGUAGE LOCK for this turn: speak natural Hindi only in Devanagari (English product words like Form 18 / Graduate MLC stay in English). Do not mix Telugu script. Answer the caller's latest words first — if Ending applies (not interested, out of area, wrong person), close in Hindi (ठीक है, धन्यवाद) then [END:not_interested] or [END:wrong_person] correctly. Never ask DOB/address/KYC. Prefer the Instructions over any generic brevity rule.",
      });
    } else if (code === "en-IN") {
      messages.push({ role: "system", content: languageLock(agent) });
    } else {
      messages.push({
        role: "system",
        content: `LANGUAGE LOCK for this turn: speak ${lang.label} primarily in the ${lang.native} script unless the caller clearly switched. Keep [END:...] tags in ASCII. Answer the caller's latest words first. Closing lines must match this active language. Never ask DOB/address/KYC.`,
      });
    }
  }
  return messages;
}

function sanitizeSpoken(text, language = "te-IN") {
  let next = String(text || "")
    .replace(/^\s*(?:VOICE STREAM|Knowledge Base Query|LANGUAGE LOCK|Instructions?|System)\s*:\s*[^\n]*\n?/gim, "")
    .replace(/ధన్యవాదాలు\.?/g, "")
    .replace(/అప్లికేషన్\s*ఫారం|అప్లికేషన్\s*ఫార్మ్|ఫార్మే|ఫార్మ్|ఫారం/g, "Form 18")
    .replace(/\bForm\s*18\s*Form\s*18\b/gi, "Form 18")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
  const code = getLanguage(language).code;
  if (code === "hi-IN") {
    next = next
      .replace(/ग्रेजुएट/gi, "Graduate")
      .replace(/एम\.?\s*एल\.?\s*सी\.?|एमएलसी/gi, "MLC")
      .replace(/वोटर/gi, "voter")
      .replace(/रजिस्ट्रेशन|पंजीकरण/gi, "registration")
      .replace(/फॉर्म\s*18/gi, "Form 18")
      .replace(/क्वालिटी/gi, "quality")
      .replace(/व्हाट्सऐप|व्हाट्सएप/gi, "WhatsApp");
  }
  // Only repair corrupted Telugu endings when Telugu is active.
  if (code === "te-IN") {
    next = next
      .replace(/सరే\s*అండి\.?/g, "సరే అండి.")
      .replace(/सारे\s*अंडी\.?|सरे\s*अंडी\.?|सरे\s*अन्डि\.?/gi, "సరే అండి.");
  }
  return next;
}

export function parseSpoken(content, language = "te-IN") {
  if (!content) return { text: "", endCall: false, disposition: null };
  let raw = String(content).replace(/```json|```/g, "").trim();
  const end = raw.match(/\[END:([a-z_]+)\]/i);
  raw = raw.replace(/\[END:[a-z_]+\]/gi, "").trim();
  let parsed;
  if (raw.startsWith("{")) {
    try {
      const json = JSON.parse(raw);
      parsed = {
        text: sanitizeSpoken(String(json.text || "").trim(), language),
        endCall: Boolean(json.endCall || end),
        disposition: json.disposition || end?.[1]?.toLowerCase() || null,
      };
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    parsed = {
      text: sanitizeSpoken(raw, language),
      endCall: Boolean(end),
      disposition: end?.[1]?.toLowerCase() || null,
    };
  }
  return enforceClosingLine(parsed, language);
}

function closingLineFor(disposition, language = "te-IN") {
  const code = getLanguage(language).code;
  if (disposition === "not_interested" || disposition === "wrong_person") {
    if (code === "hi-IN") return "ठीक है, धन्यवाद।";
    if (code === "en-IN") return "Okay, thank you. Goodbye.";
    return "సరే అండి.";
  }
  if (disposition === "do_not_call") {
    if (code === "hi-IN") return "ठीक है, दोबारा कॉल नहीं करेंगे।";
    if (code === "en-IN") return "Okay, I will note not to call again. Goodbye.";
    return "సరే, మళ్లీ call చేయవద్దన్న మీ request నమోదు చేస్తున్నాను.";
  }
  if (disposition === "callback_requested") {
    if (code === "hi-IN") return "ठीक है, आपके बताए समय पर कॉल करूँगी।";
    if (code === "en-IN") return "Okay, I will call you back at the time you said.";
    return "సరే, మీరు చెప్పిన time note చేశాను.";
  }
  if (code === "hi-IN") return "ठीक है, धन्यवाद।";
  if (code === "en-IN") return "Okay, thank you. Goodbye.";
  return "సరే అండి.";
}

function enforceClosingLine(parsed, language = "te-IN") {
  const disposition = parsed?.disposition;
  if (!parsed?.endCall || !disposition) return parsed;
  if (["not_interested", "wrong_person", "do_not_call"].includes(disposition)) {
    return { ...parsed, text: closingLineFor(disposition, language) };
  }
  if (disposition === "callback_requested") {
    const text = String(parsed.text || "").trim();
    if (!text || /సరే|सारे|सरे|ठीक है|okay|thank you/i.test(text)) {
      return { ...parsed, text: closingLineFor(disposition, language) };
    }
  }
  return parsed;
}

export function guardEarlyHangup(parsed, call) {
  const userTurns = (call?.messages || []).filter((m) => m.role === "user").length;
  const allowed = ["not_interested", "do_not_call", "wrong_person", "callback_requested"];
  if (parsed.endCall && userTurns < 2 && !allowed.includes(parsed.disposition)) {
    return { ...parsed, endCall: false, disposition: null };
  }
  return parsed;
}

/** Detect clear caller intents that must override the script. */
export function detectCallerIntent(userText) {
  const text = String(userText || "").trim();
  const lower = text.toLowerCase();
  if (!text) return {
    wrongPerson: false,
    outOfArea: false,
    notGraduate: false,
    notInterested: false,
    doNotCall: false,
    callbackRequested: false,
  };

  const wrongPerson = /wrong (person|number)|galat (number|person|aadmi|banda)|गलत (नंबर|व्यक्ति|आदमी)|వేరే (వ్యక్తి|నెంబర్|వాళ్ళు)|not (me|him|her)\b|main ravi nahi (hoon|hun)|मेरा नाम नहीं|मैं रवि नहीं हूँ|मैं वो नहीं हूँ|నేను కాదు|wrong (log|banda)/i.test(text);
  const notGraduate = /not (a )?graduate|graduate (nahi|nahin|नहीं)|ग्रेजुएट नहीं|graduation नहीं|డిగ్రీ లేదు|graduate కాదు/i.test(text);
  const outsideCity = /\b(chandigarh|mohali|delhi|mumbai|punjab|haryana|bangalore|bengaluru|kolkata|jaipur|pune)\b/i.test(text)
    || /चंडीगढ़|चण्डीगढ़|मोहाली|दिल्ली|मुंबई|पंजाब|हरियाणा/.test(text);
  const declineArea = /not for me|won'?t be for me|mere liye.{0,40}(nahi|nahin|नहीं)|मेरे लिए.{0,40}(नहीं|ना)|नहीं होगा|ye mere liye|यह मेरे लिए|out of (area|state|constituency)|दूसरे (शहर|राज्य)|different (city|state)|इधर का नहीं|उधर (साइड|side)|mere area|hyderabad.{0,24}(nahi|नहीं)|constituency.{0,24}(nahi|नहीं)/i.test(text);
  const outOfArea = !notGraduate && (
    declineArea || (outsideCity && /(nahi|nahin|नहीं|not for|won'?t|नहीं होगा|ka nahi|का नहीं)/i.test(text))
  );
  const doNotCall = /do not call|don't call|dnc|कॉल मत|फोन मत|दोबारा (मत|नहीं)|మళ్లీ call చేయవద్దు/i.test(text);
  const callbackRequested = !doNotCall && /call (me )?(back )?(tomorrow|later|in the evening|at \d)|(?:kal|baad mein|shaam ko).{0,30}call|कल.{0,30}(कॉल|फोन)|बाद में.{0,30}(कॉल|फोन)|తర్వాత.{0,30}call|రేపు.{0,30}call/i.test(text);
  // User asking the agent to continue / explain is NOT a refusal.
  const wantsContinue = /क्या बात|आगे (बता|बात|क्या)|what (do you|did you|is it)|tell me|बोलना है|बताना चाह|बात करो|आगे करो|kyun call|why (did you|are you) call/i.test(text);
  const softRefuse = /(मन नहीं|दिल नहीं|रुचि नहीं|दिलचस्पी नहीं|बात नहीं करनी|नहीं करना चाह|interested नहीं|not interested|no thanks|not now|వద్దు|అక్కర్లేదు)/i.test(text);
  const notInterested = !wrongPerson && !wantsContinue && (
    doNotCall
    || softRefuse
    || /(not interested|no thanks|not now)/i.test(lower)
  );

  return {
    wrongPerson,
    outOfArea,
    notGraduate,
    notInterested: notInterested || outOfArea || notGraduate,
    doNotCall,
    callbackRequested,
  };
}

function outOfAreaClosing(language) {
  const code = getLanguage(language).code;
  if (code === "hi-IN") return "ठीक है, यह आपके क्षेत्र के लिए नहीं है। धन्यवाद।";
  if (code === "en-IN") return "Okay, this isn't for your area. Thank you, goodbye.";
  return "సరే అండి, ఇది మీ area కోసం కాదు.";
}

function notGraduateClosing(language) {
  const code = getLanguage(language).code;
  if (code === "hi-IN") return "समझ गई। यह Graduate MLC registration graduates के लिए है। धन्यवाद।";
  if (code === "en-IN") return "Understood. This Graduate MLC registration is for graduates. Thank you, goodbye.";
  return "అర్థమైంది అండి. ఈ Graduate MLC registration graduates కోసం. Thank you.";
}

/** Force correct ending when the caller clearly declined or is out of area. */
export function intentDrivenReply(agent, userText) {
  const intent = detectCallerIntent(userText);
  const lang = getLanguage(agent?.language).code;
  if (intent.wrongPerson) {
    return {
      text: closingLineFor("wrong_person", lang),
      endCall: true,
      disposition: "wrong_person",
    };
  }
  if (intent.doNotCall) {
    return {
      text: closingLineFor("do_not_call", lang),
      endCall: true,
      disposition: "do_not_call",
    };
  }
  if (intent.callbackRequested) {
    return {
      text: closingLineFor("callback_requested", lang),
      endCall: true,
      disposition: "callback_requested",
    };
  }
  if (intent.outOfArea) {
    return {
      text: outOfAreaClosing(lang),
      endCall: true,
      disposition: "not_interested",
    };
  }
  if (intent.notGraduate) {
    return {
      text: notGraduateClosing(lang),
      endCall: true,
      disposition: "not_interested",
    };
  }
  if (intent.notInterested) {
    return {
      text: closingLineFor("not_interested", lang),
      endCall: true,
      disposition: "not_interested",
    };
  }
  return null;
}

/** Fix bad LLM endings (wrong_person misuse, wrong closing language). */
export function normalizeEndDisposition(parsed, agent, userText) {
  if (!parsed) return parsed;
  const intent = detectCallerIntent(userText);
  const lang = getLanguage(agent?.language).code;
  let next = { ...parsed };

  if (intent.wrongPerson) {
    return {
      text: closingLineFor("wrong_person", lang),
      endCall: true,
      disposition: "wrong_person",
    };
  }
  if (
    intent.outOfArea
    || intent.notGraduate
    || intent.notInterested
    || intent.doNotCall
    || intent.callbackRequested
  ) {
    const disposition = intent.doNotCall
      ? "do_not_call"
      : intent.callbackRequested
        ? "callback_requested"
        : "not_interested";
    return {
      text: intent.outOfArea
        ? outOfAreaClosing(lang)
        : intent.notGraduate
          ? notGraduateClosing(lang)
          : closingLineFor(disposition, lang),
      endCall: true,
      disposition,
    };
  }

  // Never keep wrong_person without a clear identity mismatch.
  if (next.disposition === "wrong_person" && !intent.wrongPerson) {
    if (next.endCall) {
      return {
        text: closingLineFor("not_interested", lang),
        endCall: true,
        disposition: "not_interested",
      };
    }
    next = { ...next, disposition: null, endCall: false };
  }

  if (next.endCall && next.disposition) {
    return enforceClosingLine({ ...next, text: next.text || closingLineFor(next.disposition, lang) }, lang);
  }
  return next;
}

export function followCustomerLanguage(call, agent, userText) {
  const settings = agent?.callSettings || {};
  const current = call?.language || agent?.language || "en-IN";
  const requested = detectRequestedLanguage(userText);
  const sttHint = /^(te|hi|en)-IN$/.test(String(call?._sttLanguageHint || ""))
    ? call._sttLanguageHint
    : "";
  if (call) delete call._sttLanguageHint;
  if (settings.switchLanguage === false && !requested) {
    if (call) call.language = current;
    return current;
  }
  const detected = requested || sttHint || (settings.autoDetectLanguage === false
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

  const intent = intentDrivenReply(speaking, userText);
  if (intent) return { ...intent, slots, provider: "intent", model: null };

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
      return {
        ...normalizeEndDisposition(guardEarlyHangup(result, call), speaking, userText),
        slots,
        provider: llm.provider,
        model: llm.model,
      };
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
          return {
            ...normalizeEndDisposition(guardEarlyHangup(result, call), speaking, userText),
            slots,
            provider: backup.provider,
            model: backup.model,
          };
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
  const lang = agent?.language || "te-IN";
  let parsed = parseSpoken(content, lang);
  if (forcedEnd) {
    parsed.endCall = true;
    parsed.disposition = forcedEnd;
    if (!parsed.text) {
      parsed.text = extra || defaultEndLine(forcedEnd, agent);
    }
    parsed = enforceClosingLine(parsed, lang);
  }
  if (transfer) parsed.transfer = transfer;
  return parsed;
}

function cannedVoiceTurn({ agent, history, userText, slots }) {
  const usersBefore = (history || []).filter((m) => m.role === "user").length;
  const turn = Math.max(0, usersBefore);
  const text = String(userText || "").trim();
  const name = String(slots?.customer_name || slots?.name || "").trim();
  const honorific = name ? `${name} గారు` : "గారు";

  // Intent endings apply on any turn (not only the first reply).
  const intent = intentDrivenReply(agent, userText);
  if (intent) return intent;

  // Deterministic language switch: no repeated greeting or awkward transliteration.
  const requestedLanguage = detectRequestedLanguage(text);
  if (requestedLanguage === "hi-IN") {
    return {
      text: "हाँ, हिंदी में बात कर सकती हूँ। Graduate MLC voter registration के बारे में बस तीस seconds बात करनी थी—क्या अभी समय है?",
      endCall: false,
      disposition: null,
    };
  }
  if (requestedLanguage === "en-IN") {
    return {
      text: "Sure, I can speak in English. This is about Graduate MLC voter registration—may I take thirty seconds?",
      endCall: false,
      disposition: null,
    };
  }
  if (requestedLanguage === "te-IN") {
    return {
      text: "అవును, తెలుగులో మాట్లాడతాను. Graduate MLC voter registration గురించి ముప్పై seconds చెప్పొచ్చా?",
      endCall: false,
      disposition: null,
    };
  }

  const activeLanguage = getLanguage(agent?.language).code;
  if (/kyun call|kyu call|क्यों (कॉल|फोन)|why (are|did) you call|ఎందుకు call/i.test(text)) {
    if (activeLanguage === "hi-IN") {
      return {
        text: "Graduate MLC voter registration की जानकारी और मदद के लिए कॉल किया है। क्या मैं तीस seconds में बता दूँ?",
        endCall: false,
        disposition: null,
      };
    }
    if (activeLanguage === "en-IN") {
      return {
        text: "I called to explain Graduate MLC voter registration and offer help. May I take thirty seconds?",
        endCall: false,
        disposition: null,
      };
    }
    return {
      text: "Graduate MLC voter registration గురించి సమాచారం, help ఇవ్వడానికి call చేశాను. ముప్పై seconds చెప్పొచ్చా?",
      endCall: false,
      disposition: null,
    };
  }

  if (/form\s*18.{0,30}(kya|क्या|what)|(?:kya|क्या|what).{0,30}form\s*18/i.test(text)) {
    if (activeLanguage === "hi-IN") {
      return {
        text: "Form 18, Graduate MLC voter list में registration का form है। क्या इसका official link WhatsApp पर भेज दूँ?",
        endCall: false,
        disposition: null,
      };
    }
    if (activeLanguage === "en-IN") {
      return {
        text: "Form 18 is used to register on the Graduate MLC voter list. Shall I send the official link on WhatsApp?",
        endCall: false,
        disposition: null,
      };
    }
    return {
      text: "Form 18, Graduate MLC voter listలో registration కోసం. Official link WhatsAppలో పంపమంటారా?",
      endCall: false,
      disposition: null,
    };
  }

  // Only first user reply after greeting for short affirmations.
  if (turn > 1) return null;

  // Strict short affirmations only (avoid matching longer questions).
  if (text.length <= 28 && (
    /^(yes|yeah|yep|ok|okay|sure|haan|हां|जी हाँ|जी|అవును|చెప్పండి|మాట్లాడొచ్చు|మాట్లాడవచ్చు)([,.!\s]*)$/i.test(text)
    || /^(అవును[\s,]*చెప్పండి)([,.!\s]*)$/i.test(text)
  )) {
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
  return closingLineFor(disposition, agent?.language || "te-IN");
}

async function chatCompletion(llm, { agent, messages, tools, stream, maxTokens }) {
  const rich = Array.isArray(agent?.instructionSections) && agent.instructionSections.length;
  const defaultMax = stream
    ? rich ? 180 : 110
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
      ...normalizeEndDisposition(
        guardEarlyHangup(parseSpoken(full, speaking.language || call?.language), call),
        speaking,
        userText
      ),
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
      return {
        ...normalizeEndDisposition(guardEarlyHangup(result, call), speaking, userText),
        slots,
        provider: llm.provider,
        model: llm.model,
      };
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
