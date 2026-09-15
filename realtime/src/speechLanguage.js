const ROMAN_HINDI =
  /\b(hai|hain|kya|nahi|nahin|mein|baat|karo|bolo|samajh|aap|hum|theek|bilkul)\b/i;
const ENGLISH_MARKERS =
  /\b(the|is|are|you|your|because|please|about|this|that|have|has|will|would|could|don't|dont|understand)\b/gi;

function latinCount(raw) {
  return (String(raw || "").match(/[A-Za-z]/g) || []).length;
}

/** Full mobile number (10–15 digits). */
export function looksLikePhoneDigits(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const digits = digitCount(raw);
  if (digits.length < 10 || digits.length > 15) return false;
  const letters = (raw.match(/[A-Za-z\u0900-\u097F\u0C00-\u0C7F]/g) || []).length;
  return letters <= 2;
}

/** STT mid-dial fragment (e.g. "912 045", "z91") — keep listening, do not reply yet. */
export function hasPartialPhoneDigits(text) {
  const raw = String(text || "").trim();
  const digits = digitCount(raw);
  if (digits.length < 2 || digits.length >= 10) return false;
  const normalized = raw.replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 5 && /\b(number|mobile|phone|whatsapp|digit)\b/i.test(normalized)) return false;
  return words.length <= 4;
}

/** Caller checking the line is still live — never restart the greeting. */
export function isPresenceCheck(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/^hello(?:\s+hello){0,4}\??\.?$/i.test(raw)) return true;
  if (/^(hi|hey)\??\.?$/i.test(raw)) return true;
  if (/are you (?:there|saying something|still there)/i.test(raw) && raw.length < 48) return true;
  return false;
}

function digitCount(text) {
  return String(text || "").replace(/\D/g, "");
}

/** Caller is answering, requesting, or consenting — never treat as echo or cut-off noise. */
/**
 * Caller asking why we called / what this is about — even broken STT like "What is about?"
 * voice-purpose-question-v1 — from call_d99d3a05-2 Anika dropped "Yes. Have a minute. What is about?"
 * as noise because open-tail treated trailing "about" as mid-sentence.
 */
export function isPurposeQuestion(text) {
  const lower = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!lower) return false;
  if (/\bwhat(?:'?s| is| was)?\s+(?:this|it|that)?\s*about\b/.test(lower)) return true;
  if (/\bwhat is about\b/.test(lower)) return true;
  if (/\bwhy (?:are you|did you|do you|you)\s+call/.test(lower)) return true;
  if (/\bwhat(?:'?s| is)\s+(?:this|the)\s+(?:call|regarding|for)\b/.test(lower)) return true;
  if (/\bkya baat\b|\bक्या बात\b|ఏం విషయం|ఎందుకు కాల్/i.test(String(text || ""))) return true;
  return false;
}

/** Caller saying the agent missed them — do not ask them to repeat again. */
export function isListeningComplaint(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/\b(not listening|aren't listening|are not listening|didn't (?:catch|hear)|did not (?:catch|hear)|can't hear me|cannot hear me|not hearing)\b/i.test(raw)) {
    return true;
  }
  if (/सुन नहीं|सुन नहीं रहे|सुन ही नहीं|వినట్లేదు|వినడం లేదు|వినటం లేదు/i.test(raw)) return true;
  return false;
}

/** Affirmative answer to "got a minute?" — permission already granted. */
export function grantsTalkTime(text) {
  const lower = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!lower) return false;
  if (/\b(have a minute|got a minute|i have time|i'?m free|yes i can talk|yeah i can talk)\b/.test(lower)) {
    return true;
  }
  if (/^(yes|yeah|yep|sure|ok|okay)\b/.test(lower) && /\b(minute|time|talk|speak|go ahead|seconds)\b/.test(lower)) {
    return true;
  }
  // "Yes. I have." / "Yes I have please" after "do you have thirty seconds?"
  if (/^(yes|yeah|yep|sure)\b/.test(lower) && /\bi have\b/.test(lower) && lower.split(/\s+/).length <= 6) {
    return true;
  }
  return false;
}

/**
 * Short answers that only make sense against the agent's last question
 * ("Yes, I have." / "Yes, I am." / "No, I don't.") — never treat as cut-off STT.
 * voice-elliptical-affirmation-v1 — Priya call_8a2a9ee8-5 / call_6bac5b70-0.
 */
export function isEllipticalAffirmation(text) {
  const lower = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!lower) return false;
  if (
    /^(yes|yeah|yep|yup|sure|haan|हां|जी)[,.]?\s+i\s+(have|am|do|did|can|will|would|did)(?:\s+please)?\.?$/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /^(no|nope|nah|nahi|नहीं)[,.]?\s+i\s+(don'?t|do not|haven'?t|am not|can'?t|will not|won'?t)(?:\s+\w+){0,3}\.?$/.test(
      lower
    )
  ) {
    return true;
  }
  if (/^(yes|yeah|yep|sure)[,.]?\s+i\s+have(?:\s+it|one|that|a degree|the degree)?\.?$/.test(lower)) {
    return true;
  }
  if (/^(yes|yeah|yep|sure)\.?$/.test(lower)) return true;
  return false;
}

export function hasCallerIntent(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const normalized = raw.replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (/^(yes|yeah|yep|sure|ok|okay|no|nope|haan|हां|जी)$/i.test(lower)) return true;
  if (isEllipticalAffirmation(raw) || isPurposeQuestion(raw) || isListeningComplaint(raw) || grantsTalkTime(raw)) {
    return true;
  }
  if (/\b(you can|i can|can you|go ahead|send me|just send|please send)\b/i.test(normalized)) {
    return true;
  }
  if (/\b(want|need|upload|register|book|call|stop|wait)\b/i.test(normalized) && words.length >= 3) {
    return true;
  }
  if (/\bon whatsapp\b/i.test(normalized)) return true;
  if (
    /\bwhatsapp\b/i.test(normalized)
    && /\b(send|please|yes|yeah|me|my|link)\b/i.test(normalized)
    && words.length >= 3
  ) {
    return true;
  }
  if (/\b(send|link)\b/i.test(normalized) && words.length >= 4) return true;
  if (/\b(this number|same number|my number|on file|in memory|you have|already have|that number)\b/i.test(normalized)) {
    return true;
  }
  if (looksLikePhoneDigits(raw)) return true;
  return false;
}

export function looksLikeEnglishSentence(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/[\u0900-\u097F\u0C00-\u0C7F]/.test(raw)) return false;
  if (ROMAN_HINDI.test(raw)) return false;
  const markers = raw.match(ENGLISH_MARKERS) || [];
  return markers.length >= 3 && latinCount(raw) >= 28;
}

/**
 * Explicit caller language-switch requests only.
 * Includes Telugu-script STT of Hindi/English requests when Deepgram is pinned to `te`
 * (e.g. "హిందీవే బాతకరు" for "हिंदी में बात करो").
 */
/**
 * Languages the caller says they do NOT understand.
 *
 * voice-language-switch-negation-v1 — "talk in English because I don't understand Hindi"
 * names two languages, and the naive reading picked the rejected one. A rejected language
 * can never be the language we switch to.
 */
const LANGUAGE_NAMES = [
  { code: "hi", re: /hindi|हिंदी|हिन्दी|హిందీ|హింది/gi },
  { code: "te", re: /telugu|तेलुगु|तेलगु|तेलुगू|తెలుగు/gi },
  { code: "en", re: /english|अंग्रेजी|इंग्लिश|इंग्लीश|ఇంగ్లీష్|ఇంగ్లిష్|ఇంగ్లీషు/gi },
  { code: "ta", re: /tamil|तमिल|தமிழ்|తమిళ/gi },
];

/**
 * A language name only counts as rejected when it sits next to the negation.
 * Word order differs by language: English puts the object after ("don't understand Hindi"),
 * Hindi and Telugu put it before ("तेलुगु समझ नहीं आती").
 */
function namesNear(raw, start, end, { before = 0, after = 0 }) {
  const found = new Set();
  for (const { code, re } of LANGUAGE_NAMES) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(raw)) !== null) {
      const at = match.index;
      const nameEnd = at + match[0].length;
      if (before && nameEnd <= start && start - nameEnd <= before) found.add(code);
      if (after && at >= end && at - end <= after) found.add(code);
    }
  }
  return found;
}

function rejectedLanguages(raw, lower) {
  const rejected = new Set();
  const add = (set) => {
    for (const code of set) rejected.add(code);
  };

  /*
   * English / romanised — object follows the verb, and must be adjacent. A wider window
   * reaches into the next clause and would reject the language being asked for:
   * "I don't understand Telugu, talk in English".
   */
  const en = /(?:don'?t|dont|do not|cannot|can'?t|not)\s+(?:understand|know|follow|get|speak)/g;
  for (let m; (m = en.exec(lower)) !== null; ) {
    add(namesNear(raw, m.index, m.index + m[0].length, { after: 10 }));
  }

  // Hindi — "<language> समझ नहीं आती".
  const hi = /समझ\s*(?:में)?\s*(?:नहीं|नहिं)|समझता\s*नहीं|आती\s*नहीं/g;
  for (let m; (m = hi.exec(raw)) !== null; ) {
    add(namesNear(raw, m.index, m.index + m[0].length, { before: 28 }));
  }

  // Telugu — "<language> అర్థం కావడం లేదు".
  const te = /(?:అర్థం|అర్ధం)[^.!?]{0,20}?(?:లేదు|కాదు|రాదు)/g;
  for (let m; (m = te.exec(raw)) !== null; ) {
    add(namesNear(raw, m.index, m.index + m[0].length, { before: 28 }));
  }

  return rejected;
}

export function detectExplicitLanguageSwitch(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const rejected = rejectedLanguages(raw, lower);

  const wantsHindi =
    (/\bhindi\b/.test(lower) && /\b(talk|speak|in|mein|me|baat|please|karo|bolo|can|you|ho|se|mujhe|mujhse)\b/.test(lower))
    || (/हिंदी|हिन्दी/.test(raw) && /बात|बोल|में|करो|कर|मुझ/.test(raw))
    || (/హిందీ|హింది/.test(raw) && /బాత|మాట|మాట్లాడ|కరు|బోల|మేము|మాట్ల/.test(raw));

  const wantsEnglish =
    (/\benglish\b/.test(lower) && /\b(talk|speak|in|mein|please|can|you|don't|dont|understand)\b/.test(lower))
    || (/(?:don't|dont|do not)\s+understand/.test(lower) && /\btelugu\b/.test(lower))
    || (/अंग्रेजी|इंग्लिश/.test(raw) && /बात|बोल|में/.test(raw))
    || (/ఇంగ్లీష్|ఇంగ్లిష్|ఇంగ్లీషు/.test(raw) && /మాట్లాడ|మాట|బాత|అర్థం|అర్ధం/.test(raw));

  const wantsTelugu =
    (/\btelugu\b/.test(lower) && /\b(talk|speak|in|mein|please|baat|karo|bolo)\b/.test(lower))
    || (/తెలుగు/.test(raw) && /మాట్లాడ/.test(raw));

  // A language the caller just said they cannot understand is never the target.
  if (wantsHindi && !rejected.has("hi")) return "hi";
  if (wantsEnglish && !rejected.has("en")) return "en";
  if (wantsTelugu && !rejected.has("te")) return "te";

  /*
   * Only a rejection was legible ("मुझे तेलुगु समझ नहीं आती" alone). Falling back to the
   * caller's own script is better than staying in a language they cannot follow.
   */
  if (rejected.size) {
    if (/[\u0900-\u097F]/.test(raw) && !rejected.has("hi")) return "hi";
    if (/[\u0C00-\u0C7F]/.test(raw) && !rejected.has("te")) return "te";
    if (/[A-Za-z]/.test(raw) && !rejected.has("en")) return "en";
  }

  return null;
}

/**
 * @param {string} text
 * @param {string} current
 * @param {{ locked?: boolean }} [opts]
 * When locked=true after an explicit switch, do not flip STT back to Telugu
 * just because Deepgram still emits Telugu script for Hindi audio.
 */
export function detectSpeechLanguage(text, current = "te", opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const explicit = detectExplicitLanguageSwitch(raw);
  if (explicit) return explicit;

  if (opts.locked) {
    // Still allow a clear English sentence to leave hi/te without saying "English".
    if ((current === "hi" || current === "te") && looksLikeEnglishSentence(raw)) return "en";
    return null;
  }

  const hasHindi = /[\u0900-\u097F]/.test(raw);
  const hasTelugu = /[\u0C00-\u0C7F]/.test(raw);

  if (hasHindi && !hasTelugu) return "hi";
  if (hasTelugu) return "te";
  if (current === "hi" || current === "te") {
    return looksLikeEnglishSentence(raw) ? "en" : null;
  }
  if (looksLikeEnglishSentence(raw)) return "en";
  return null;
}

export function isShortAffirmation(text) {
  const normalized = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return /^(yes|yeah|yep|yup|sure|ok|okay|correct|right|haan|हां|जी|hi|hello|hey|go ahead|yeah sure|yes please|yeah yeah|yes yes|yeah yeah go ahead|yes go ahead|sure go ahead|please go ahead)$/i.test(
    normalized
  );
}

/** Brief caller listening acks — agent should mm-hmm and continue, not go silent or ask to repeat. */
export function isUserBackchannel(text) {
  const raw = String(text || "").trim();
  if (/^hello\s*\?\s*$/i.test(raw)) return true;
  if (/^hello(?:\s+hello){1,4}\.?$/i.test(raw)) return true;
  const normalized = raw
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;

  if (/^mm[\s-]*hmm$/i.test(normalized)) return true;
  const compact = normalized.replace(/[\s-]+/g, "");
  if (/^(?:h+m+|m+m+|mmhmm+|uhhuh|mhm|hm+)$/.test(compact)) return true;
  // "okay" is a listening ack; yes/yeah/sure remain full affirmations (checked below).
  if (/^(ok|okay|haan|हां|जी|theek|ठीक|achha|अच्छा)$/.test(normalized)) return true;
  if (isShortAffirmation(normalized)) return false;
  if (/^hello are you there(?: yeah| yes)?$/.test(normalized)) return true;
  if (/are you (?:there|saying something|still there)/.test(normalized) && normalized.length < 48) {
    return true;
  }
  if (/^(?:go on|continue|carry on)\.?$/.test(normalized)) return true;
  return false;
}

/**
 * Caller wants the agent to keep talking after an interrupt overlap
 * ("no no continue", "go on", "you were saying").
 */
export function wantsAgentToContinue(text) {
  const lower = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!lower) return false;
  if (/\b(don't|do not|stop talking|not interested)\b/.test(lower)) return false;
  if (/^(no+|nope|nah)\b/.test(lower) && /\b(continue|go on|go ahead|keep going|finish|carry on)\b/.test(lower)) {
    return true;
  }
  if (/^(please )?(continue|go on|carry on|keep going|finish|you (were|are) saying)(\s+please)?\.?$/.test(lower)) {
    return true;
  }
  if (/\b(continue|go on|keep going|you were saying)\b/.test(lower) && lower.split(/\s+/).length <= 8) {
    return true;
  }
  if (/^(जारी रखो|बोलो|बोलिए|कहत रहो|చెప్పండి|కొనసాగించండి)\.?$/u.test(String(text || "").trim())) {
    return true;
  }
  return false;
}

/**
 * Caller clarifying they were not speaking / it was noise — stay quiet, do not ask to repeat.
 */
export function isNotSpeakingCue(text) {
  const lower = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!lower) return false;
  if (
    /\b(not saying|wasn't saying|was not saying|didn't say|did not say|saying nothing|said nothing|nothing|never mind|nevermind|ignore (that|me|it)|background)\b/.test(
      lower
    )
  ) {
    return true;
  }
  if (/कुछ नहीं|नहीं बोल|कुछ बोला नहीं|ఏమీ చెప్పలేదు|ఏం లేదు/.test(String(text || ""))) return true;
  return false;
}

/** Soft human listening invite — never robotic "I didn't catch that". */
export function softListenPrompt(lang = "en") {
  if (lang === "hi") return "जी, बोलिए — मैं सुन रही हूँ।";
  if (lang === "te") return "చెప్పండి, వింటున్నాను.";
  return "Sorry — go ahead, I'm listening.";
}

export function looksLikeSttNoise(text, current = "te") {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (looksLikePhoneDigits(raw)) return false;
  if (isUserBackchannel(raw)) return false;
  if (wantsAgentToContinue(raw) || isNotSpeakingCue(raw)) return false;
  if (isShortAffirmation(raw)) return false;
  if (detectExplicitLanguageSwitch(raw)) return false;
  const normalized = raw.replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const letters = latinCount(normalized);
  // Short acks are real turns in any language (incl. "Yes." with punctuation).
  if (/^(yes|yeah|yep|ok|okay|no|nope|sure|haan|हां|जी)$/i.test(normalized)) return false;
  if (current === "en" && /^(hi|hello)$/i.test(normalized)) return false;

  if (current === "en") {
    if (isIncompleteUserUtterance(raw)) return true;
    if (words.length === 1 && letters < 12) return true;
    if (/^(aankhen|you are not|i am saying any)$/i.test(normalized)) return true;
    if (words.length <= 4 && /\bsaying any\b/i.test(normalized)) return true;
    return false;
  }

  if (current !== "hi" && current !== "te") return false;
  if (/[\u0900-\u097F\u0C00-\u0C7F]/.test(raw)) return false;
  if (ROMAN_HINDI.test(normalized) && letters >= 12) return false;
  if (/^(?:no\.?\s*){2,}/i.test(raw)) return true;
  if (/^hello\??\.?$/i.test(raw) || /^hello$/i.test(normalized)) return true;
  if (/\bwho\b/i.test(normalized) && words.length <= 4) return true;
  if (words.length <= 4 && letters < 24) return true;
  return false;
}

function compactSpeech(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

/** Studio STT sometimes prefixes interim captions with "speaking". */
export function stripSttUiPrefix(text) {
  return String(text || "")
    .replace(/^speaking(?=[\p{L}\p{M}\p{N}]|\s)/iu, "")
    .replace(/^speaking\s*/i, "")
    .trim();
}

const GREETING_OPENER = /^(?:नमस्ते|namaste|namaskar|hello|hi|hey|నమస్కార(?:ం)?)$/iu;

/** First word of agent greeting echoed from speaker → mic (Meera "नमस्ते" loop). */
export function isGreetingOpenerEcho(heard, lastSpoken = "") {
  const raw = stripSttUiPrefix(heard);
  const spoken = String(lastSpoken || "").trim();
  if (!raw || !spoken) return false;
  const normalized = raw.replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  if (isShortAffirmation(normalized)) return false;
  if (!GREETING_OPENER.test(normalized)) return false;
  const spokenOpen = spoken.slice(0, 48);
  if (/नमस्ते|namaste|namaskar|hello|hi\b|hey\b|నమస్కార/i.test(spokenOpen)) {
    if (/नमस्ते/i.test(normalized) && /नमस्ते/.test(spokenOpen)) return true;
    if (/namaste|namaskar/i.test(normalized) && /namaste|namaskar/i.test(spokenOpen)) return true;
    if (/^hello$/i.test(normalized) && /\bhello\b/i.test(spokenOpen)) return true;
    if (/^hi$/i.test(normalized) && /\bhi\b/i.test(spokenOpen)) return true;
    if (/^hey$/i.test(normalized) && /\bhey\b/i.test(spokenOpen)) return true;
    if (/నమస్కార/.test(normalized) && /నమస్కార/.test(spokenOpen)) return true;
  }
  return false;
}

/**
 * The caller is signing off, even with words wrapped around it.
 *
 * voice-closing-tail-v1 — "Yeah. Yeah. Okay, Thank you." ends in "you", which the open-tail
 * check read as a sentence cut in half. The turn was dropped as noise, so instead of a
 * goodbye the caller got "I didn't catch that completely. Could you please repeat?" and
 * then a goodbye. `isClearCallerClose` only matches a bare "thank you", so it missed this.
 */
export function hasClosingTail(text) {
  const normalized = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (
    /\b(thank you|thanks|thank u|thankyou|thank you so much|goodbye|good bye|bye bye|bye|that'?s all|thats all|nothing else|no thanks)$/i.test(
      normalized
    )
  ) {
    return true;
  }
  if (/(धन्यवाद|शुक्रिया|थैंक यू|अलविदा|बस इतना ही)$/u.test(normalized)) return true;
  if (/(ధన్యవాదాలు|థాంక్యూ|సెలవు|అంతే)$/u.test(normalized)) return true;
  return false;
}

/**
 * STT finalized too early — short open phrase, no sentence end (e.g. "hello are", "what type of").
 * Agent must stay silent and keep listening, not say "I didn't catch that".
 */
export function isIncompleteUserUtterance(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (hasPartialPhoneDigits(raw)) return true;
  if (looksLikePhoneDigits(raw)) return false;
  if (isShortAffirmation(raw) || isUserBackchannel(raw)) return false;
  if (wantsAgentToContinue(raw) || isNotSpeakingCue(raw)) return false;
  if (detectExplicitLanguageSwitch(raw)) return false;
  if (isForcedCompleteCommandLocal(raw)) return false;
  // voice-closing-tail-v1 — a sign-off is a finished thought, whatever precedes it.
  if (hasClosingTail(raw)) return false;
  // voice-purpose-question-v1 — "What is about?" / "got a minute" grants are finished turns.
  if (isPurposeQuestion(raw) || grantsTalkTime(raw) || isListeningComplaint(raw)) return false;
  // voice-elliptical-affirmation-v1 — "Yes, I have." answers the prior question; not an open tail.
  if (isEllipticalAffirmation(raw)) return false;

  const normalized = raw.replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  // Finished spoken sentence with punctuation — do not wait for more (open-tail used to win first).
  if (words.length >= 3 && /[.!?؟।]$/.test(raw) && hasCallerIntent(raw)) return false;
  // Single-word STT bleed ("eating", "previously", "z91") — wait for the full sentence.
  if (words.length === 1 && !isShortAffirmation(raw) && !looksLikePhoneDigits(raw)) return true;

  const openTail =
    /\b(are|am|is|the|a|an|of|to|in|for|what|how|do|don't|i|we|you|my|your|type|about|that|this|and|or|but|with|on|at|from|be|have|has|was|were|will|would|can|could|should|want|need|tell|say|said|asking|documents|document|hello|hi|hey|going|still|wait|just|trying|remaining|digits|number)$/i;
  if (words.length <= 8 && openTail.test(normalized) && !hasCallerIntent(raw) && !isPurposeQuestion(raw)) {
    return true;
  }

  // English possessive cut mid-noun phrase: "some test company's" → wait for the noun
  if (words.length <= 8 && /['’]s$/i.test(raw) && !hasCallerIntent(raw) && !/[.!?]$/.test(raw)) {
    return true;
  }

  // voice-hindi-open-tail-v1 — "कोई टेस्ट कंपनी का" must wait; do not reply on genitive/postposition cutoffs
  if (hasOpenLanguageTail(normalized) && !hasCallerIntent(raw) && !/[.!?؟।]$/.test(raw)) {
    return true;
  }

  if (hasCallerIntent(raw)) return false;
  if (words.length <= 3 && latinCount(normalized) < 32) return true;
  if (isSubstantiveUserTurn(raw)) return false;
  if (/[.!?؟।]$/.test(raw)) return false;

  return words.length <= 2;
}

/**
 * Mid-thought endings in Hindi / Roman Hindi / Telugu — speaker is still forming the sentence.
 * Example from studio: "कोई टेस्टकंपनी का" / "कोई टेस्ट कंपनी का"
 */
export function hasOpenLanguageTail(text) {
  const normalized = String(text || "")
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  if (/(का|की|के|में|से|पर|को|ने|और|तो|या|कि|वाला|वाली|वाले)$/u.test(normalized)) {
    return true;
  }
  if (/(యొక్క|లో|నుంచి|కి|కు|గా|మరియు)$/u.test(normalized)) return true;
  if (/\b(ka|ki|ke|mein|me|se|par|ko|ne|aur|toh|to|ya|wala|wali)\.?$/i.test(normalized)) {
    return true;
  }
  return false;
}

function isForcedCompleteCommandLocal(text) {
  const normalized = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return /^(stop|wait|hold on|please stop|stop talking|goodbye|good bye|bye|thank you|thanks|thanks a lot|thank you so much|that'?s all|thats all|not interested|no thanks|don't call|do not call|रुको|रुकिए|बस|मत बोलो|ఆపు|వద్దు|చాలు)$/i.test(
    normalized
  );
}

/** Real interrupt / barge-in — must pass through while the agent is still speaking. */
export function isBargeInCandidate(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isSubstantiveUserTurn(raw)) return true;
  if (isUserBackchannel(raw)) return true;
  if (detectExplicitLanguageSwitch(raw)) return true;
  if (/^(stop|wait|hold on|no|nope|रुको|रुकिए|बस|नहीं|मत बोलो|ఆపు|వద్దు|చాలు)\b/iu.test(raw)) return true;
  if (/please stop|stop talking|not interested|don't call|do not call/i.test(raw)) return true;
  return false;
}

/** Real caller speech must never be dropped — only short bleed / echo fragments. */
export function isSubstantiveUserTurn(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isShortAffirmation(raw) || isUserBackchannel(raw)) return true;
  if (detectExplicitLanguageSwitch(raw)) return true;
  const normalized = raw.replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (hasCallerIntent(raw) && words.length >= 2) return true;
  if (words.length >= 4) return true;
  if (latinCount(normalized) >= 28) return true;
  if (/[?？]/.test(raw)) return true;
  if (/[\u0900-\u097F\u0C00-\u0C7F]/.test(raw) && words.length >= 3) {
    if (/[?？]|कब|क्या|बताइए|चाहिए|कर/.test(raw)) return true;
    return false;
  }
  return false;
}

/**
 * Hindi/English phrase lifted verbatim from the agent's last line (speaker → mic).
 * Catches "नमस्ते", "क्या मैं Ravi जी", "CarePoint Clinic से Meera", etc.
 */
export function isLikelySpokenFragmentEcho(heard, lastSpoken = "") {
  const raw = stripSttUiPrefix(heard);
  const spoken = String(lastSpoken || "").trim();
  if (!raw || !spoken) return false;
  if (isShortAffirmation(raw) || isUserBackchannel(raw)) return false;
  if (detectExplicitLanguageSwitch(raw)) return false;
  if (hasCallerIntent(raw)) return false;

  const heardBits = compactSpeech(raw);
  const spokenBits = compactSpeech(spoken);
  if (!heardBits || heardBits.length < 4 || !spokenBits.includes(heardBits)) return false;

  const heardWords = raw.split(/\s+/).filter(Boolean);
  // Long caller turns that happen to share words with the agent are not echo.
  if (heardWords.length >= 8 && /[?？]|कब|क्या\b.*\?|please|want|need|chahiye|चाहिए/i.test(raw)) {
    return false;
  }
  if (heardBits.length <= 96) return true;
  return heardBits.length / spokenBits.length < 0.55;
}

export function isLikelyAgentEcho(heard, lastSpoken = "") {
  const raw = stripSttUiPrefix(heard);
  const spoken = String(lastSpoken || "").trim();
  if (!raw || !spoken) return false;
  if (isGreetingOpenerEcho(raw, spoken)) return true;
  if (isLikelySpokenFragmentEcho(raw, spoken)) return true;

  const heardWords = raw.split(/\s+/).filter(Boolean);
  const brands = [...new Set((spoken.match(/[A-Za-z]{4,}/g) || []).map((w) => w.toLowerCase()))];
  if (
    heardWords.length <= 5
    && !/[?।]|कब|क्या|बताइए|चाहिए|\bwhen\b|\bwhich\b|\bbook\b/i.test(raw)
    && brands.some((b) => /care|clinic|point|meera|priya|anika|nova|fixit/.test(b))
    && /केयर|प्वाइंट|क्लिनिक|मीरा|प्रिया|केयरपॉइंट/i.test(raw)
  ) {
    return true;
  }

  if (isSubstantiveUserTurn(raw)) return false;
  if (hasCallerIntent(raw)) return false;

  const heardBits = compactSpeech(raw);
  const spokenBits = compactSpeech(spoken);
  if (heardBits.length >= 4 && heardBits.length <= 22 && spokenBits.includes(heardBits)) return true;
  if (heardBits.length >= 6 && heardBits.length <= 18 && spokenBits.includes(heardBits)) return true;

  const spokenWords = spoken.split(/\s+/).filter((w) => compactSpeech(w).length >= 3);
  const spokenSet = new Set(spokenWords.map((w) => compactSpeech(w)));
  const overlap = heardWords.filter((w) => spokenSet.has(compactSpeech(w))).length;
  const callerIntent =
    /please|want|need|yes|yeah|sure|book|help|chahiye|चाहिए|बताइए|karo|kariye/i.test(raw);
  if (heardWords.length <= 4 && overlap >= Math.ceil(heardWords.length * 0.6) && !callerIntent) {
    return true;
  }
  if (
    heardWords.length >= 3
    && heardWords.length <= 4
    && overlap / heardWords.length >= 0.55
    && !callerIntent
  ) {
    return true;
  }
  if (heardWords.length > 4) return false;

  const heardLatin = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (heardWords.length <= 2) {
    for (const brand of brands) {
      if (heardLatin.length >= 4 && (heardLatin === brand || brand.includes(heardLatin))) {
        return true;
      }
    }
  }
  return false;
}
