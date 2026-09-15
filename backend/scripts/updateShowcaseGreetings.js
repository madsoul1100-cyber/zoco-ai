/**
 * Push only the greeting fields from showcasePacks.js onto existing showcase agents.
 *
 * seedShowcaseAgents.js also rewrites status, tests, and customTools, so it is the wrong
 * tool for a copy tweak on an agent someone is actively testing.
 *
 * Usage (from backend/):
 *   node scripts/updateShowcaseGreetings.js --dry
 *   node scripts/updateShowcaseGreetings.js
 */
import { connectInfra } from "../src/infra/connect.js";
import { mongoState } from "../src/infra/mongo.js";
import { loadEnv } from "../src/loadEnv.js";
import { ensureStore, getAgent, saveAgent } from "../src/store.js";
import { SHOWCASE_AGENTS } from "../../frontend/src/lib/showcasePacks.js";

loadEnv();
if (!mongoState.ready) await connectInfra();
await ensureStore();

const dryRun = process.argv.includes("--dry");

function greetingFor(spec) {
  if (spec.language === "hi-IN") return spec.greetingHi;
  if (spec.language === "en-IN") return spec.greetingEn;
  return spec.greetingTe;
}

function words(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

for (const spec of SHOWCASE_AGENTS) {
  const agent = await getAgent(spec.id);
  if (!agent) {
    console.log(`skip   ${spec.id} (not seeded yet — run seedShowcaseAgents.js first)`);
    continue;
  }

  const greeting = greetingFor(spec);
  if (agent.greeting === greeting) {
    console.log(`ok     ${spec.id} already current (${words(greeting)} words)`);
    continue;
  }

  console.log(`update ${spec.id}`);
  console.log(`   was (${words(agent.greeting)} words): ${agent.greeting}`);
  console.log(`   now (${words(greeting)} words): ${greeting}`);

  if (dryRun) continue;

  await saveAgent({
    ...agent,
    greeting,
    greetings: {
      ...(agent.greetings || {}),
      "te-IN": spec.greetingTe,
      "en-IN": spec.greetingEn,
      "hi-IN": spec.greetingHi,
    },
    updatedAt: new Date().toISOString(),
  });
}

console.log(dryRun ? "\ndry run — nothing written" : "\ngreetings updated");
process.exit(0);
