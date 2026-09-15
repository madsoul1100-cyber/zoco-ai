/**
 * voice-conversation-script-v1
 * Multi-turn human↔agent decision scripts (no live mic).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnSimulator } from "../src/turnSimulator.js";
import { decideUserTurn, isClearCallerClose } from "../src/sessionTuning.js";

const GREETING =
  "Hi, this is Priya from the team. Do you have thirty seconds?";

test("script: first-turn Hello is understood as a reply", () => {
  const sim = createTurnSimulator({
    lastSpoken: GREETING,
    greetingActive: false,
    ttsLanguage: "en",
  });
  const result = sim.handleUser({ user: "Hello", label: "first hello" });
  assert.equal(result.turn, "reply");
  assert.equal(result.stopResponse, false);
  assert.equal(result.acceptedTurns, 1);
  assert.equal(result.effectiveUserText, "Hello");
});

test("script: mid-call Hello becomes presence-check resume, not silence", () => {
  const sim = createTurnSimulator({
    acceptedTurns: 1,
    lastSpoken: "Shall I send the WhatsApp link?",
    ttsLanguage: "en",
  });
  const result = sim.handleUser({ user: "Hello?", label: "mid hello" });
  assert.equal(result.turn, "reply");
  assert.equal(result.stopResponse, false);
  assert.match(result.effectiveUserText, /presence-check/);
  assert.match(result.effectiveUserText, /WhatsApp/);
});

test("script: stop / wait / goodbye / thank you are replies, not stuck noise_repair", () => {
  for (const sample of ["stop", "wait", "hold on", "goodbye", "thank you", "not interested"]) {
    assert.equal(
      decideUserTurn(sample, { ttsLanguage: "en", lastSpoken: GREETING }),
      "reply",
      sample
    );
  }
  assert.equal(isClearCallerClose("thank you"), true);
  assert.equal(isClearCallerClose("Thank you, send the link"), false);
});

test("script: incomplete open phrase waits; full sentence replies", () => {
  const sim = createTurnSimulator({ lastSpoken: GREETING, ttsLanguage: "en" });
  const cut = sim.handleUser({ user: "what type of", label: "cut-off" });
  assert.equal(cut.turn, "noise_repair");
  assert.equal(cut.stopResponse, true);
  assert.equal(cut.coalesce, "what type of");

  const full = sim.handleUser({
    user: "course should I choose?",
    label: "continuation",
  });
  assert.equal(full.turn, "reply");
  assert.equal(full.stopResponse, false);
  assert.match(full.effectiveUserText, /what type of course/);
});

test("script: agent echo is ignored and does not poison the next real sentence", () => {
  const sim = createTurnSimulator({
    lastSpoken:
      "My apologies, I'll send that WhatsApp link to you right now.",
    ttsLanguage: "en",
  });
  const echo = sim.handleUser({ user: "WhatsApp link", label: "echo" });
  assert.equal(echo.turn, "ignore");
  assert.equal(echo.stopResponse, true);
  assert.equal(echo.coalesce, "");

  const real = sim.handleUser({
    user: "Yes, send it on this number",
    label: "real",
    lastSpoken: "Shall I send the WhatsApp link?",
  });
  assert.equal(real.turn, "reply");
  assert.equal(real.effectiveUserText, "Yes, send it on this number");
});

test("script: full Priya-style happy path stays reply/reply/reply", () => {
  const sim = createTurnSimulator({
    lastSpoken: GREETING,
    ttsLanguage: "en",
  });
  const results = sim.runScript([
    { user: "Yes, I have a minute", lastSpoken: GREETING },
    {
      user: "Can you explain this Graduate MLC registration please",
      lastSpoken: "This is about Graduate MLC registration. May I continue?",
    },
    {
      user: "Yes, you can send the WhatsApp link",
      lastSpoken: "Shall I send the Form 18 link on WhatsApp?",
    },
  ]);
  assert.deepEqual(
    results.map((r) => r.turn),
    ["reply", "reply", "reply"]
  );
  assert.equal(results.at(-1).acceptedTurns, 3);
});

test("script: Hindi mid-sentence का waits then merges continuation", () => {
  const sim = createTurnSimulator({
    lastSpoken: "क्या मैं WhatsApp पर पेमेंट लिंक भेज दूँ?",
    ttsLanguage: "hi",
  });
  const cut = sim.handleUser({ user: "कोई टेस्ट कंपनी का", label: "cut" });
  assert.equal(cut.turn, "noise_repair");
  assert.equal(cut.stopResponse, true);

  const full = sim.handleUser({
    user: "नाम Nova Skills है",
    label: "rest",
  });
  assert.equal(full.turn, "reply");
  assert.equal(full.stopResponse, false);
  assert.match(full.effectiveUserText, /टेस्ट कंपनी का नाम/);
});

test("script: backchannel while agent speaks does not steal the turn", () => {
  const sim = createTurnSimulator({
    acceptedTurns: 2,
    agentBusy: true,
    lastSpoken: "I can send the link now.",
    ttsLanguage: "en",
  });
  const result = sim.handleUser({ user: "Okay", agentBusy: true });
  assert.equal(result.turn, "backchannel");
  assert.equal(result.stopResponse, true);
  assert.equal(result.accepted, false);
});
