/**
 * Compare Priya pilot metrics between Twilio TwiML and LiveKit runtimes.
 * Usage: node scripts/compareLiveKitPilot.js
 */
import { connectInfra } from "../src/infra/connect.js";
import { mongoState } from "../src/infra/mongo.js";
import { loadEnv } from "../src/loadEnv.js";
import { listCalls } from "../src/store.js";

loadEnv();
if (!mongoState.ready) await connectInfra();

const agentId = process.env.LIVEKIT_PILOT_AGENT_ID || "agt_priya_mlc_outbound";
const calls = (await listCalls()).filter((call) => call.agentId === agentId);

function summarize(runtime) {
  const subset = calls.filter((call) => (call.runtime || "twilio") === runtime);
  const completed = subset.filter((call) => call.status === "completed");
  const metrics = subset.flatMap((call) => call.telemetry?.events || []);
  const turnLatency = metrics
    .filter((item) => item.name === "turn_latency_ms")
    .map((item) => Number(item.value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const median = turnLatency.length
    ? turnLatency[Math.floor(turnLatency.length / 2)]
    : null;
  const p95 = turnLatency.length
    ? turnLatency[Math.floor(turnLatency.length * 0.95)]
    : null;
  return {
    runtime,
    calls: subset.length,
    completed: completed.length,
    medianTurnLatencyMs: median,
    p95TurnLatencyMs: p95,
  };
}

const report = [summarize("twilio"), summarize("livekit")];
console.log(JSON.stringify({ agentId, report }, null, 2));
