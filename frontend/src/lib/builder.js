export const DEFAULT_CALL_SETTINGS = {
  speakingSpeed: 0.95,
  pitch: 0,
  ttsTemperature: 0.42,
  temperature: 0.4,
  allowInterrupt: true,
  eagerness: 7,
  volumeThresholdDb: -48,
  backgroundSound: "off",
  backgroundVolume: 0.12,
  switchLanguage: true,
  allowedLanguages: ["en-IN", "hi-IN", "te-IN"],
  autoDetectLanguage: true,
  indicNumbers: false,
  pronunciations: null,
  sarvamDictId: "",
  nudgeEnabled: true,
  nudges: [
    { id: "nudge_1", message: "Hello? Are you still on the call?", afterSeconds: 14 },
    { id: "nudge_2", message: "Hello?", afterSeconds: 18 },
  ],
  hangupAfterNudges: false,
  voicemailEnabled: false,
  voicemailMessage: "Hey, seems like I have reached your voicemail. I will call you back later.",
  maxCallMinutes: 15,
};

export const DEFAULT_OUTPUT_VARS = [
  {
    key: "call_summary",
    dataType: "string",
    prompt: "A short 1-2 line description of what happened on the call",
    isGoal: true,
  },
];

export const SYSTEM_TOOLS = [
  {
    id: "end_interaction",
    name: "End Interaction",
    runs: "During call",
    kind: "Built-in",
    description:
      "Use this when the conversation reaches a natural end, the instructions say to hang up, or the caller asks to end. Always speak a short closing line in the current language first.",
  },
  {
    id: "query_knowledge",
    name: "Query Knowledge Base",
    runs: "During call",
    kind: "Built-in",
    description:
      "Invoke this when you need facts from attached knowledge bases — policies, product details, or FAQs. Do not invent answers from memory when a matching document exists.",
  },
  {
    id: "transfer_to_human",
    name: "Transfer to human",
    runs: "During call",
    kind: "Built-in",
    description:
      "Warm-transfer the live Twilio call to the number in Settings. Speak a one-line handoff first.",
  },
];

export function callSettings(agent) {
  return { ...DEFAULT_CALL_SETTINGS, ...(agent?.callSettings || {}) };
}

export function inputVariables(agent) {
  const rows = Array.isArray(agent?.inputVariables)
    ? agent.inputVariables
    : (agent?.variables || []).map((item) => ({
        key: item.key,
        defaultValue: item.defaultValue || item.example || item.value || "",
      }));
  const filtered = rows.filter((item) => item?.key);
  return filtered.length ? filtered : [{ key: "customer_name", defaultValue: "" }, { key: "user_name", defaultValue: "" }];
}

export function outputVariables(agent) {
  const rows = Array.isArray(agent?.outputVariables) ? agent.outputVariables : [];
  return rows.length ? rows : DEFAULT_OUTPUT_VARS;
}

export function customTools(agent) {
  return Array.isArray(agent?.customTools) ? agent.customTools : [];
}

export function agentTests(agent) {
  return Array.isArray(agent?.tests) ? agent.tests : [];
}

export function patchSettings(agent, patch) {
  return { ...agent, callSettings: { ...callSettings(agent), ...patch } };
}
