/**
 * Seeds three production-style showcase agents (clinic, course registration, home service).
 * Run from backend/: node scripts/seedShowcaseAgents.js
 */
import { connectInfra } from "../src/infra/connect.js";
import { mongoState } from "../src/infra/mongo.js";
import { loadEnv } from "../src/loadEnv.js";
import { ensureStore, getAgent, getKnowledgeBase, saveAgent, saveKnowledgeBase } from "../src/store.js";
import { compileInstructions, sectionsFromPack } from "../../frontend/src/lib/instructionPacks.js";
import { SHOWCASE_AGENTS } from "../../frontend/src/lib/showcasePacks.js";

loadEnv();
if (!mongoState.ready) await connectInfra();
await ensureStore();

const now = new Date().toISOString();

const knowledgeDocs = {
  agt_meera_clinic_booking: [
    {
      id: "doc_clinic_hours",
      name: "CarePoint hours and departments",
      kind: "text",
      text: `CarePoint Clinic, Banjara Hills, Hyderabad.
OPD 9 AM to 8 PM Monday to Saturday. Sunday emergency only — do not book routine OPD on Sunday.
Departments: General Physician, Gynaecology, Paediatrics, Diagnostics.
First OPD visit: arrive 15 minutes early with any previous reports. Late by more than 15 minutes, slot may be released.
Reports for tests done before noon: same day after 6 PM at the desk. Later tests: next working day.`,
      createdAt: now,
    },
    {
      id: "doc_clinic_emergency",
      name: "Emergency boundary",
      kind: "text",
      text: `Chest pain, breathing difficulty, heavy bleeding, unresponsive child: tell them to go to emergency or call 108. Do not book a routine slot. Do not diagnose.`,
      createdAt: now,
    },
  ],
  agt_anika_course_complete: [
    {
      id: "doc_nova_courses",
      name: "Nova Skills courses",
      kind: "text",
      text: `Nova Skills live online programmes.
Data Analytics Foundation: 12 weeks, weekday 7–9 PM or weekend 10–1.
Digital Marketing Practitioner: 10 weeks, same batch windows.
Spoken English Studio: 8 weeks, evening batch only.
Registration is incomplete until documents are uploaded and the fee step is opened. Seat is not held until payment shows.
Documents: 10th marksheet or government ID photo on the same form. Never collect Aadhaar number, OTP, or card details on the call.
EMI is explained by a counsellor after the form, not quoted as a guaranteed rate on this call.`,
      createdAt: now,
    },
  ],
  agt_kabir_home_service: [
    {
      id: "doc_fixit_coverage",
      name: "FixIt coverage and visit charge",
      kind: "text",
      text: `FixIt Home Services covers Hyderabad, Secunderabad, and GHMC limits only.
Visit inspection charge: 299 rupees, adjustable in the final bill if the customer approves the repair.
Typical slots: today 4–7 PM, tomorrow 10–1. Emergency sparking / gas smell / water on electrical board: offer the earliest window and tell them to switch off mains if safe.
Spare-part prices are quoted by the technician after inspection. Never invent a compressor or PCB price on the call.`,
      createdAt: now,
    },
  ],
};

function greetingFor(spec) {
  if (spec.language === "hi-IN") return spec.greetingHi;
  if (spec.language === "en-IN") return spec.greetingEn;
  return spec.greetingTe;
}

const callSettings = {
  speakingSpeed: 1.02,
  pitch: 0,
  ttsTemperature: 0.58,
  temperature: 0.4,
  allowInterrupt: true,
  eagerness: 8,
  volumeThresholdDb: -48,
  backgroundSound: "quiet_office",
  backgroundVolume: 0.1,
  switchLanguage: true,
  allowedLanguages: ["te-IN", "hi-IN", "en-IN"],
  autoDetectLanguage: true,
  indicNumbers: false,
  pronunciations: [],
  nudgeEnabled: true,
  nudges: [
    { id: "nudge_1", message: "Hello? Are you still there?", afterSeconds: 14 },
    { id: "nudge_2", message: "Hello?", afterSeconds: 18 },
  ],
  hangupAfterNudges: false,
  voicemailEnabled: true,
  voicemailMessage: "Hey, I reached your voicemail. I will call you back later.",
  maxCallMinutes: 12,
};

const seeded = [];

for (const spec of SHOWCASE_AGENTS) {
  const instructionSections = sectionsFromPack(spec.pack, spec.titles, spec.id.replace("agt_", "sec_"));
  const instructions = compileInstructions(instructionSections);
  const greeting = greetingFor(spec);

  const existingKb = await getKnowledgeBase(spec.kbId);
  const kb = await saveKnowledgeBase({
    id: spec.kbId,
    name: spec.kbName,
    description: `Controlled knowledge for ${spec.name}.`,
    documents: knowledgeDocs[spec.id] || [],
    createdAt: existingKb?.createdAt || now,
    updatedAt: now,
  });

  const existingAgent = await getAgent(spec.id);
  const agent = await saveAgent({
    id: spec.id,
    name: spec.name,
    direction: spec.direction,
    category: spec.category,
    status: "draft",
    version: Number(existingAgent?.version || 0) + 1,
    useCase: spec.useCase,
    persona: instructions,
    instructions,
    instructionSections,
    greeting,
    greetings: {
      "te-IN": spec.greetingTe,
      "en-IN": spec.greetingEn,
      "hi-IN": spec.greetingHi,
    },
    successCriteria: spec.successCriteria,
    defaultSuccessDisposition: spec.defaultSuccessDisposition,
    language: spec.language,
    voice: spec.voice,
    gender: spec.gender,
    llmProvider: "openrouter",
    llmModel: process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash",
    ttsProvider: "sarvam",
    ttsModel: "bulbul:v3",
    ttsVoice: spec.ttsVoice,
    knowledgeBaseIds: [kb.id],
    inputVariables: [
      { key: "customer_name", defaultValue: "" },
    ],
    outputVariables: spec.outputs.map((row) => ({ ...row })),
    customTools: [],
    callSettings: { ...callSettings },
    tests: [],
    workflow: { enabled: false, nodes: [] },
    createdAt: existingAgent?.createdAt || now,
    updatedAt: now,
  });

  seeded.push({
    id: agent.id,
    name: agent.name,
    language: agent.language,
    sections: agent.instructionSections.length,
    kb: kb.id,
  });
}

console.log(JSON.stringify({ ok: true, agents: seeded }, null, 2));
