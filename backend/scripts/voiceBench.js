/**
 * Bench voice path latency (no mic). Run: node scripts/voiceBench.js
 */
import { loadEnv } from "../src/loadEnv.js";
import { connectInfra } from "../src/infra/connect.js";
import { getAgent } from "../src/store.js";
import { streamReply, followCustomerLanguage } from "../src/engine/conversation.js";
import { getTtsClip } from "../src/engine/tts.js";

loadEnv();
await connectInfra();

const agent = await getAgent("agt_priya_mlc_outbound");
if (!agent) {
  console.error("Priya agent not found — run seedPriyaMlc.js first");
  process.exit(1);
}

const call = {
  id: "bench_call",
  status: "in_progress",
  language: "te-IN",
  messages: [{ role: "assistant", text: agent.greeting }],
  gathered: { customer_name: "Manan" },
  customer: { name: "Manan", phone: "+910000000000" },
};

async function bench(label, userText) {
  const snapshot = structuredClone(call);
  followCustomerLanguage(snapshot, agent, userText);
  let firstTokenMs = null;
  let fullMs = null;
  const t0 = performance.now();
  const reply = await streamReply({
    agent: { ...agent, language: snapshot.language },
    call: snapshot,
    userText,
    knowledge: "",
    onToken: () => {
      if (firstTokenMs == null) firstTokenMs = Math.round(performance.now() - t0);
    },
  });
  fullMs = Math.round(performance.now() - t0);
  console.log(`\n[${label}]`);
  console.log(`  lang: ${snapshot.language}${snapshot.languageLocked ? ` (locked ${snapshot.languageLocked})` : ""}`);
  console.log(`  TTFT: ${firstTokenMs ?? fullMs}ms  total: ${fullMs}ms  provider: ${reply.provider}`);
  console.log(`  reply: ${String(reply.text || "").slice(0, 100)}...`);
  return { firstTokenMs: firstTokenMs ?? fullMs, fullMs, reply };
}

const hindi = await bench("Hindi switch", "Hindi mein baat kariye");
const ack = await bench("Short ack", "haan boliye");

const tts0 = performance.now();
try {
  const clip = await getTtsClip({
    text: "हाँ, हिंदी में बात कर सकती हूँ। Graduate MLC voter registration के बारे में बस तीस seconds बात करनी थी।",
    agent: { ...agent, language: "hi-IN", ttsProvider: "sarvam", ttsVoice: "kavya", ttsModel: "bulbul:v3" },
    callSettings: agent.callSettings,
  });
  const ttsMs = Math.round(performance.now() - tts0);
  console.log(`\n[TTS Sarvam kavya] ${ttsMs}ms  provider: ${clip?.provider}  bytes: ${clip?.audioUrl ? "url ok" : "n/a"}`);
} catch (err) {
  console.log(`\n[TTS Sarvam] FAILED: ${err.message}`);
}

console.log("\nDone.");
process.exit(0);
