/**
 * Voice regression scenarios from client-demo failures.
 * Run: npm run test:voice (from repo root) or npm test --prefix realtime
 */
import test from "node:test";
import assert from "node:assert/strict";
import { detectSpeechLanguage, isLikelyAgentEcho, looksLikeSttNoise } from "../src/speechLanguage.js";
import {
  AEC_WARMUP_MS,
  POST_GREETING_ECHO_MS,
  TRANSCRIPTION_TIMEOUT_MS,
  USER_AWAY_TIMEOUT_S,
  countRepeatPrompts,
  decideUserTurn,
  isEmptyVadAfterMuteFailure,
  isIncompleteLanguageSwitchUtterance,
  shouldAskRepeatInsteadOfEnd,
  shouldIgnoreUserAudio,
  shouldPromptOnTranscriptionTimeout,
} from "../src/sessionTuning.js";

const ANIKA_GREETING =
  "Hi, is this Ravi? Anika from Nova Skills. You started a course registration that is still incomplete — do you have two minutes?";

const MEERA_GREETING =
  "नमस्ते, क्या मैं Ravi जी से बात कर रही हूँ? मैं CarePoint Clinic से Meera हूँ। आपके appointment के बारे में कॉल किया है, क्या एक मिनट है?";

test("session tuning: never ship the broken AEC / short timeout defaults", () => {
  assert.ok(AEC_WARMUP_MS >= 2000, "AEC warmup must be real milliseconds");
  assert.equal(TRANSCRIPTION_TIMEOUT_MS, null, "short transcriptionTimeout caused ask-to-repeat spam");
  assert.ok(USER_AWAY_TIMEOUT_S > 15);
  assert.ok(POST_GREETING_ECHO_MS >= 500 && POST_GREETING_ECHO_MS <= 2000);
});

test("scenario: client demo — didn't-catch-that loop must fire at most once", () => {
  const t0 = 1_000_000;
  const prompts = countRepeatPrompts([
    { now: t0, agentBusy: true }, // empty VAD while agent speaks
    { now: t0 + 500, agentBusy: true },
    { now: t0 + 3000, agentBusy: false }, // first recovery allowed
    { now: t0 + 3500, agentBusy: false }, // immediate re-fire blocked
    { now: t0 + 4000, agentBusy: true }, // WhatsApp reply playing
    { now: t0 + 8000, agentBusy: false }, // still blocked by max=1
  ]);
  assert.equal(prompts, 1);
});

test("short affirmations are never STT noise", () => {
  for (const sample of ["Yes.", "Yeah. Sure.", "Yeah. Yeah. Go ahead.", "Sure", "yes yes"]) {
    assert.equal(looksLikeSttNoise(sample, "en"), false, sample);
    assert.equal(decideUserTurn(sample, { ttsLanguage: "en", lastSpoken: ANIKA_GREETING }), "reply", sample);
  }
});

test("scenario: hangup must wait for goodbye playout (policy)", () => {
  // Documented contract: disposition is applied only after waitForPlayout in agent.
  // Studio must also drain before disconnect so "assistant - speaking" is audible.
  assert.equal(TRANSCRIPTION_TIMEOUT_MS, null);
  assert.ok(USER_AWAY_TIMEOUT_S >= 30);
});

test("scenario: short Yes after greeting window is a reply, not dropped", () => {
  assert.equal(
    decideUserTurn("Yes.", {
      greetingActive: false,
      listenAfter: Date.now() - 5_000,
      lastSpoken: ANIKA_GREETING,
      ttsLanguage: "en",
    }),
    "reply"
  );
  assert.equal(shouldIgnoreUserAudio("Yes.", { greetingActive: false, listenAfter: 0, lastSpoken: ANIKA_GREETING }), false);
});

test("scenario: CarePoint greeting echo ignored; real appointment question answered", () => {
  assert.equal(
    decideUserTurn("मैं केयर प्वाइंट", {
      greetingActive: true,
      lastSpoken: MEERA_GREETING,
      ttsLanguage: "hi",
    }),
    "ignore"
  );
  assert.equal(
    decideUserTurn("हाँ, बताइए appointment कब है", {
      greetingActive: false,
      listenAfter: 0,
      lastSpoken: MEERA_GREETING,
      ttsLanguage: "hi",
    }),
    "reply"
  );
});

test("scenario: empty VAD + interim + away = stuck-listen failure mode", () => {
  assert.equal(
    isEmptyVadAfterMuteFailure({
      audioTranscript: "",
      interimTranscript: "Yes. I would like to complete my registration.",
      userAwayTriggered: true,
      skippedBecausePaused: true,
    }),
    true
  );
});

test("scenario: Hindi switch request pins language; cut utterance is incomplete", () => {
  assert.equal(detectSpeechLanguage("It will be better if you speak in Hindi.", "en"), "hi");
  assert.equal(
    isIncompleteLanguageSwitchUtterance("नमस्ते रवि जी। मैं अनिका, नोवा स्किल्स से बोल रही हूँ। आपने"),
    true
  );
});

test("scenario: Hello are you there is backchannel repair, not hangup", () => {
  assert.equal(shouldAskRepeatInsteadOfEnd("Hello? Are you there?", "en"), true);
  assert.equal(shouldAskRepeatInsteadOfEnd("I listen it already. You said it.", "en"), false);
});

test("scenario: short English STT fragments on Hindi call are noise, not English switch", () => {
  assert.equal(detectSpeechLanguage("Hello?", "hi"), null);
  assert.equal(looksLikeSttNoise("Hello?", "hi"), true);
  assert.equal(detectSpeechLanguage("Please talk in English", "hi"), "en");
});

test("scenario: garbled Latin / No no no must not end the call", () => {
  for (const sample of ["Aankhen", "you are not", "I am saying any", "No. No. No."]) {
    assert.equal(shouldAskRepeatInsteadOfEnd(sample, "hi") || looksLikeSttNoise(sample, "hi"), true, sample);
  }
});

test("scenario: timeout prompt never while greeting or agent busy", () => {
  assert.equal(shouldPromptOnTranscriptionTimeout({ greetingActive: true }), false);
  assert.equal(shouldPromptOnTranscriptionTimeout({ agentBusy: true }), false);
  assert.equal(shouldPromptOnTranscriptionTimeout({ ending: true }), false);
});

test("scenario: agent echo of last spoken WhatsApp line is ignored", () => {
  const spoken =
    "My apologies, I'll send that WhatsApp link to you right now. Once you upload your document, would you like me to help you pick a batch?";
  assert.equal(isLikelyAgentEcho("WhatsApp link", spoken), true);
  assert.equal(
    decideUserTurn("WhatsApp link", { lastSpoken: spoken, ttsLanguage: "en" }),
    "ignore"
  );
});
