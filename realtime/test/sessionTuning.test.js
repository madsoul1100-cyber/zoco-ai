import test from "node:test";
import assert from "node:assert/strict";
import {
  AEC_WARMUP_MS,
  TRANSCRIPTION_TIMEOUT_MS,
  USER_AWAY_TIMEOUT_S,
  buildLiveKitSessionOptions,
  isEmptyVadAfterMuteFailure,
  isIncompleteLanguageSwitchUtterance,
  shouldAskRepeatInsteadOfEnd,
  shouldPromptOnTranscriptionTimeout,
} from "../src/sessionTuning.js";
import { isLikelyAgentEcho, looksLikeSttNoise } from "../src/speechLanguage.js";

test("AEC warmup is real milliseconds, not fractional seconds", () => {
  assert.ok(AEC_WARMUP_MS >= 2000);
  assert.notEqual(AEC_WARMUP_MS, 0.35);
  const opts = buildLiveKitSessionOptions();
  assert.equal(opts.aecWarmupDuration, AEC_WARMUP_MS);
  assert.equal(opts.userAwayTimeout, USER_AWAY_TIMEOUT_S);
  assert.equal(opts.transcriptionTimeout, TRANSCRIPTION_TIMEOUT_MS);
  assert.equal(TRANSCRIPTION_TIMEOUT_MS, null);
  assert.ok(opts.userAwayTimeout > 15);
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
