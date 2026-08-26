/**
 * Run identical Priya chat cases for side-by-side comparison with Sarvam.
 * Usage: node scripts/comparePriyaCases.js
 */
import { loadEnv } from "../src/loadEnv.js";

loadEnv();

const BASE = process.env.PUBLIC_API_URL || "http://localhost:8787";
const AGENT = "agt_priya_mlc_outbound";

const CASES = [
  {
    id: "case1_hindi_form18",
    label: "Hindi switch + willing + Form 18",
    turns: [
      "मुझे हिंदी में बात करनी है, क्या आप हिंदी में बात करते हैं?",
      "हाँ, अभी time है। मैं SD हूँ।",
      "Form 18 के बारे में बताइए",
    ],
  },
  {
    id: "case2_not_interested",
    label: "Not interested after greeting",
    turns: ["नहीं चाहिए, interested नहीं हूँ"],
  },
  {
    id: "case3_busy_callback",
    label: "Busy / call later",
    turns: ["अभी busy हूँ, बाद में call करो"],
  },
];

async function jar() {
  const jar = { cookie: "" };
  const res = await fetch(`${BASE}/api/auth/skip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const set = res.headers.getSetCookie?.() || [];
  jar.cookie = set.map((c) => c.split(";")[0]).join("; ") || "";
  if (!jar.cookie) {
    const raw = res.headers.get("set-cookie");
    if (raw) jar.cookie = raw.split(",").map((c) => c.split(";")[0].trim()).join("; ");
  }
  return jar;
}

async function api(jar, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: jar.cookie,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  return body;
}

async function runCase(jar, testCase) {
  const call = await api(jar, "/api/calls", {
    method: "POST",
    body: JSON.stringify({
      agentId: AGENT,
      channel: "chat",
      language: "te-IN",
      customer: { name: "SD", phone: "+910000000000", customer_name: "SD" },
      variables: { customer_name: "SD" },
    }),
  });
  let current = await api(jar, `/api/calls/${call.id}/connect`, { method: "POST", body: "{}" });
  const transcript = [];
  const greet = [...(current.messages || [])].reverse().find((m) => m.role === "assistant");
  if (greet) transcript.push({ role: "assistant", text: greet.text });

  for (const turn of testCase.turns) {
    transcript.push({ role: "user", text: turn });
    current = await api(jar, `/api/calls/${call.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text: turn, source: "chat" }),
    });
    const last = [...(current.messages || [])].reverse().find((m) => m.role === "assistant");
    if (last) transcript.push({ role: "assistant", text: last.text });
  }

  return {
    id: testCase.id,
    label: testCase.label,
    status: current.status,
    disposition: current.disposition || null,
    language: current.language,
    transcript,
  };
}

const auth = await jar();
const results = [];
for (const testCase of CASES) {
  results.push(await runCase(auth, testCase));
}
console.log(JSON.stringify({ platform: "zoco", results }, null, 2));
