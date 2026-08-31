/**
 * Seeds "Priya - MLC outbound agent" to match the Bolna/production Priya config.
 * Run: node scripts/seedPriyaMlc.js  (from backend/)
 */
import { connectInfra } from "../src/infra/connect.js";
import { mongoState } from "../src/infra/mongo.js";
import { loadEnv } from "../src/loadEnv.js";
import { ensureStore, getAgent, getKnowledgeBase, saveAgent, saveKnowledgeBase } from "../src/store.js";
import { ensureSarvamDictId, loadPriyaDictionary, pronunciationCount } from "../src/engine/pronunciation.js";
import {
  INSTRUCTION_SECTION_TITLES,
  MLC_INSTRUCTION_PACK,
  MLC_OUTPUT_VARS,
  compileInstructions,
} from "../../frontend/src/lib/instructionPacks.js";

loadEnv();
if (!mongoState.ready) await connectInfra();
await ensureStore();

const now = new Date().toISOString();
const KB_ID = "kb_mlc_graduates_priya";
const AGENT_ID = "agt_priya_mlc_outbound";

const pronunciations = await loadPriyaDictionary();
let sarvamDictId = "";
const sarvamKey = String(process.env.SARVAM_API_KEY || "").trim();
if (sarvamKey) {
  try {
    sarvamDictId = await ensureSarvamDictId(sarvamKey, pronunciations);
    console.log("Uploaded Sarvam pronunciation dict:", sarvamDictId);
  } catch (error) {
    console.warn("Could not upload Sarvam pronunciation dict:", error.message);
  }
}
const GREETING =
  "హలో, {{ customer_name }} గారితోనే మాట్లాడుతున్నానా? అమర్నాథ్ సారంగుల గారి టీమ్ నుంచి వాయిస్ అసిస్టెంట్ ప్రియా మాట్లాడుతున్నాను. ఒక ముప్పై సెకన్లు మాట్లాడొచ్చా?";

const instructionSections = INSTRUCTION_SECTION_TITLES.map((title, index) => ({
  id: `sec_priya_${String(index + 1).padStart(2, "0")}`,
  title,
  body: MLC_INSTRUCTION_PACK[title] || "",
}));

const instructions = compileInstructions(instructionSections);

const kbDocs = [
  {
    id: "doc_mlc_constituency",
    name: "Graduate MLC constituency and cycle",
    kind: "text",
    text: `Controlled release — Graduate MLC awareness (Mahabubnagar–Ranga Reddy–Hyderabad Graduates' Constituency).

Graduate MLC voter registration is separate from the ordinary Assembly / Lok Sabha voter list. Each regular cycle, the Graduate voter list is prepared fresh. Even if someone registered or voted on a Graduate roll in a previous election, they normally need to apply again with Form 18 after the official revision opens.

Do not claim that the Form 18 window or revision is currently open unless a later official notice document is attached.

Primary constituency for this campaign: Mahabubnagar–Ranga Reddy–Hyderabad Graduates' Constituency.

For callers outside that constituency, give neutral process help only and do not push the Amarnath awareness initiative line.

Never tell a Rajanna Sircilla resident that their regular Graduate MLC election is expected in 2027.`,
    createdAt: now,
  },
  {
    id: "doc_mlc_amarnath",
    name: "Amarnath Saarangula controlled profile",
    kind: "text",
    text: `Controlled release — Amarnath Saarangula profile for Priya outbound.

Amarnath Saarangula is an IIT Roorkee alumnus preparing to contest. His team has started a Graduate MLC voter-awareness and registration-assistance initiative so Graduates understand the separate registration process and can get guidance.

Status is prospective / preparing to contest — not an announced official nomination. An official candidate list has not yet been announced.

Never imply endorsement by ECI, CEO Telangana, government, or IIT Roorkee.
Never ask for a vote, party affiliation, political preference, intended vote, or opinion of another candidate.`,
    createdAt: now,
  },
  {
    id: "doc_mlc_form18",
    name: "Form 18 and documents guidance",
    kind: "text",
    text: `Controlled release — Form 18 / documents.

Form 18 is the Graduate electoral roll application form. Always say the English words "Form 18".

Do not say every applicant needs exactly three mandatory documents. Typically useful items include:
- Form 18 photo
- Ordinary-residence details
- Degree / qualification proof
- Voter ID or Aadhaar details when helpful

Exact document list should be confirmed after the current official notice. This call must not collect Aadhaar numbers, OTPs, full voter-ID numbers, certificate numbers, document images, date of birth, income, caste, religion, bank details, or political preference.

If the person wants the Form 18 link, ask permission to send it on WhatsApp to the same number. Do not claim a WhatsApp was sent unless a tool confirms it.`,
    createdAt: now,
  },
  {
    id: "doc_mlc_objections",
    name: "Neutral objection answers",
    kind: "text",
    text: `Controlled release — objection answers (neutral).

Why register? Registering does not compel anyone to vote. Without a name on the Graduate MLC list, the person cannot use their choice in that Graduate MLC election.

Why vote? Whether to vote is their decision. Graduate MLC is a special chance to decide who speaks for Graduates in the Council — that is why the decision has value.

Why give documents to private people? On this call, documents and sensitive numbers are not collected. Only official Form 18 link and process guidance are offered.

Do not use fear, shame, national-growth slogans, or repeated persuasion.`,
    createdAt: now,
  },
];

const existingKb = await getKnowledgeBase(KB_ID);
const kb = await saveKnowledgeBase({
  id: KB_ID,
  name: "mlc-graduates-priya-outbound",
  description: "Controlled knowledge releases for Priya Graduate MLC outbound calls.",
  documents: kbDocs,
  createdAt: existingKb?.createdAt || now,
  updatedAt: now,
});

const callSettings = {
  speakingSpeed: 1.02,
  pitch: 0,
  ttsTemperature: 0.58,
  temperature: 0.45,
  allowInterrupt: true,
  eagerness: 9,
  volumeThresholdDb: -48,
  backgroundSound: "quiet_office",
  backgroundVolume: 0.12,
  switchLanguage: true,
  allowedLanguages: ["te-IN", "hi-IN", "en-IN"],
  autoDetectLanguage: true,
  indicNumbers: false,
  pronunciations,
  sarvamDictId,
  nudgeEnabled: true,
  nudges: [
    { id: "nudge_1", message: "Hello? Are you still there?", afterSeconds: 14 },
    { id: "nudge_2", message: "Hello?", afterSeconds: 18 },
  ],
  hangupAfterNudges: false,
  voicemailEnabled: true,
  voicemailMessage: "Hey, seems like I have reached your voicemail. I shall call you back at a later time",
  maxCallMinutes: 15,
};

const existingAgent = await getAgent(AGENT_ID);
const agent = await saveAgent({
  id: AGENT_ID,
  name: "Priya - MLC outbound agent",
  direction: "outbound",
  category: "lead-qualification",
  status: "draft",
  version: 4,
  useCase:
    "Short Graduate MLC voter-awareness and registration-assistance outbound call for the Mahabubnagar–Ranga Reddy–Hyderabad Graduates' Constituency.",
  persona: instructions,
  instructions,
  instructionSections,
  greeting: GREETING,
  greetings: {
    "te-IN": GREETING,
    "en-IN":
      "Hello, am I speaking with {{ customer_name }}? This is Priya, a voice assistant calling from Amarnath Saarangula's team. Can we speak for just thirty seconds?",
    "hi-IN":
      "नमस्ते, क्या मैं {{ customer_name }} जी से बात कर रही हूँ? मैं Priya हूँ, Amarnath Saarangula की टीम से। क्या तीस सेकंड बात कर सकते हैं?",
  },
  successCriteria:
    "Move Graduate MLC awareness or registration help forward without asking for a vote or political preference.",
  defaultSuccessDisposition: "success",
  language: "te-IN",
  voice: "Priya",
  llmProvider: "openrouter",
  llmModel: process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash",
  ttsProvider: "sarvam",
  ttsModel: "bulbul:v3",
  ttsVoice: "kavya",
  knowledgeBaseIds: [kb.id],
  inputVariables: [
    { key: "customer_name", defaultValue: "" },
    { key: "caller_name", defaultValue: "Manan" },
  ],
  outputVariables: MLC_OUTPUT_VARS.map((row) => ({ ...row })),
  customTools: [],
  callSettings,
  tests: [],
  workflow: { enabled: false, nodes: [] },
  createdAt: existingAgent?.createdAt || now,
  updatedAt: now,
});

console.log(JSON.stringify({
  ok: true,
  agent: {
    id: agent.id,
    name: agent.name,
    sections: agent.instructionSections.length,
    outputs: agent.outputVariables.length,
    kb: agent.knowledgeBaseIds,
    pronunciations: pronunciationCount(agent.callSettings?.pronunciations),
    sarvamDictId: agent.callSettings?.sarvamDictId || null,
    backgroundSound: agent.callSettings?.backgroundSound,
    nudges: agent.callSettings?.nudgeEnabled,
    voicemail: agent.callSettings?.voicemailEnabled,
  },
  knowledge: { id: kb.id, name: kb.name, documents: kb.documents.length },
}, null, 2));
