import test from "node:test";
import assert from "node:assert/strict";
import {
  AEC_WARMUP_MS,
  ENDPOINTING_MAX_DELAY_MS,
  ENDPOINTING_MIN_DELAY_MS,
  INTERRUPTION_MIN_DURATION_MS,
  INTERRUPTION_MIN_WORDS,
  STT_ENDPOINTING_MS,
  TRANSCRIPTION_TIMEOUT_MS,
  USER_AWAY_TIMEOUT_S,
  GREETING_PLAYOUT_MAX_MS,
  GREETING_PLAYOUT_MIN_MS,
  buildLiveKitSessionOptions,
  greetingPlayoutBudgetMs,
  isEmptyVadAfterMuteFailure,
  isIncompleteLanguageSwitchUtterance,
  shouldAskRepeatInsteadOfEnd,
  shouldPromptOnTranscriptionTimeout,
} from "../src/sessionTuning.js";
import { isLikelyAgentEcho, looksLikeSttNoise } from "../src/speechLanguage.js";

// voice-greeting-playout-watchdog-v1
test("greeting playout budget always exceeds the time the greeting needs to speak", () => {
  // The greeting from the audited stall: 4.98s of real playout was observed for this text.
  const audited =
    "Hi, is this Anurag? Anika from Nova Skills. You started a course registration that is still incomplete — do you have two minutes?";
  const budget = greetingPlayoutBudgetMs(audited);
  assert.ok(budget > 5000, `budget ${budget} must exceed observed playout`);
  assert.ok(budget <= GREETING_PLAYOUT_MAX_MS);
});

test("greeting playout budget is clamped and never zero", () => {
  assert.equal(greetingPlayoutBudgetMs(""), GREETING_PLAYOUT_MIN_MS);
  assert.equal(greetingPlayoutBudgetMs("   "), GREETING_PLAYOUT_MIN_MS);
  // A short greeting still gets the floor, so we never cut audio off early.
  assert.equal(greetingPlayoutBudgetMs("Hello?"), GREETING_PLAYOUT_MIN_MS);
  // A very long greeting is capped, so a hung playout cannot stall the call forever.
  assert.equal(greetingPlayoutBudgetMs("word ".repeat(500)), GREETING_PLAYOUT_MAX_MS);
});

test("greeting playout budget grows with greeting length", () => {
  const short = greetingPlayoutBudgetMs("Hi, is this Anurag? Anika from Nova Skills speaking today.");
  const long = greetingPlayoutBudgetMs("word ".repeat(60));
  assert.ok(long > short, `expected ${long} > ${short}`);
});

test("AEC warmup is real milliseconds, not fractional seconds", () => {
  assert.ok(AEC_WARMUP_MS >= 2000);
  assert.notEqual(AEC_WARMUP_MS, 0.35);
  const opts = buildLiveKitSessionOptions();
  assert.equal(opts.aecWarmupDuration, AEC_WARMUP_MS);
  assert.equal(opts.userAwayTimeout, USER_AWAY_TIMEOUT_S);
  assert.equal(opts.transcriptionTimeout, TRANSCRIPTION_TIMEOUT_MS);
  assert.equal(TRANSCRIPTION_TIMEOUT_MS, null);
  assert.ok(opts.userAwayTimeout > 15);
  assert.ok(INTERRUPTION_MIN_DURATION_MS >= 400);
  assert.ok(INTERRUPTION_MIN_WORDS >= 4);
  assert.equal(opts.turnHandling.interruption.minDuration, INTERRUPTION_MIN_DURATION_MS);
  assert.equal(opts.turnHandling.interruption.minWords, INTERRUPTION_MIN_WORDS);
  // voice-snappier-endpointing-v1 — this wait, not generation, was the dead air callers felt.
  assert.equal(STT_ENDPOINTING_MS, 1500);
  assert.equal(ENDPOINTING_MIN_DELAY_MS, 1200);
  assert.equal(ENDPOINTING_MAX_DELAY_MS, 3000);
  // Still long enough that a normal pause mid-sentence does not end the turn.
  assert.ok(ENDPOINTING_MIN_DELAY_MS >= 1000);
  assert.ok(ENDPOINTING_MAX_DELAY_MS > ENDPOINTING_MIN_DELAY_MS);
  // voice-preemptive-generation-v1 — LLM runs early; TTS deliberately does not.
  assert.equal(opts.turnHandling.preemptiveGeneration.enabled, true);
  assert.equal(opts.turnHandling.preemptiveGeneration.preemptiveTts, false);
  // Must exceed our endpointing delay or no turn would ever qualify.
  assert.ok(opts.turnHandling.preemptiveGeneration.maxSpeechDuration > ENDPOINTING_MAX_DELAY_MS);
  assert.equal(opts.turnHandling.interruption.resumeFalseInterruption, true);
  assert.equal(opts.turnHandling.endpointing.minDelay, ENDPOINTING_MIN_DELAY_MS);
  assert.equal(opts.turnHandling.endpointing.maxDelay, ENDPOINTING_MAX_DELAY_MS);
});

test("transcription timeout prompt is not spammed during agent speech", () => {
  assert.equal(
    shouldPromptOnTranscriptionTimeout({
      agentBusy: true,
      promptCount: 0,
      lastPromptAt: 0,
    }),
    false
  );
  assert.equal(
    shouldPromptOnTranscriptionTimeout({
      agentBusy: false,
      promptCount: 0,
      lastPromptAt: 0,
    }),
    true
  );
  assert.equal(
    shouldPromptOnTranscriptionTimeout({
      agentBusy: false,
      promptCount: 1,
      lastPromptAt: Date.now() - 1000,
      now: Date.now(),
    }),
    false
  );
  assert.equal(
    shouldPromptOnTranscriptionTimeout({
      agentBusy: false,
      promptCount: 1,
      lastPromptAt: Date.now() - 60_000,
      now: Date.now(),
      maxPrompts: 1,
    }),
    false
  );
});

test("LiveKit log failure: interim text with empty VAD finals + away timeout", () => {
  assert.equal(
    isEmptyVadAfterMuteFailure({
      audioTranscript: "",
      interimTranscript: "Yes. I would like to complete my registration.",
      userAwayTriggered: true,
      skippedBecausePaused: true,
    }),
    true
  );
  assert.equal(
    isEmptyVadAfterMuteFailure({
      audioTranscript: "Yes. I would like to complete my registration.",
      interimTranscript: "Yes. I would like to complete my registration.",
      userAwayTriggered: false,
    }),
    false
  );
});

test("full English intent is not STT noise and must get a reply", () => {
  const text = "Yes. I would like to complete my registration.";
  assert.equal(looksLikeSttNoise(text, "en"), false);
  assert.equal(shouldAskRepeatInsteadOfEnd(text, "en"), false);
});

test("Hello are you there is a backchannel, not not-interested", () => {
  assert.equal(shouldAskRepeatInsteadOfEnd("Hello? Are you there?", "en"), true);
  assert.equal(shouldAskRepeatInsteadOfEnd("yeah", "en"), true);
});

test("cut Hindi language-switch line is incomplete", () => {
  assert.equal(isIncompleteLanguageSwitchUtterance("नमस्ते रवि जी। मैं अनिका, नोवा स्किल्स से बोल रही हूँ। आपने"), true);
  assert.equal(
    isIncompleteLanguageSwitchUtterance("जी, मैं यहीं हूँ। आपने नोवा स्किल्स पर एक कोर्स के लिए रजिस्ट्रेशन शुरू किया था, वो अभी अधूरा है। क्या आप उसे पूरा करना चाहेंगे?"),
    false
  );
});

test("CarePoint greeting echo still ignored", () => {
  const greeting =
    "नमस्ते, क्या मैं Ravi जी से बात कर रही हूँ? मैं CarePoint Clinic से Meera हूँ। आपके appointment के बारे में कॉल किया है, क्या एक मिनट है?";
  assert.equal(isLikelyAgentEcho("मैं केयर प्वाइंट", greeting), true);
});
