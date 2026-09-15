import assert from "node:assert/strict";
import test from "node:test";
import { greetingLanguageMismatch } from "../src/engine/greeting.js";
import { detectScriptLanguage } from "../src/languages.js";

const TELUGU_GREETING =
  "హలో, Manan గారితోనే మాట్లాడుతున్నానా? అమర్నాథ్ సారంగుల గారి టీమ్ నుంచి వాయిస్ అసిస్టెంట్ ప్రియా మాట్లాడుతున్నాను.";
const HINDI_GREETING = "नमस्ते, क्या मैं मनन जी से बात कर रही हूँ? मैं प्रिया बोल रही हूँ।";
const ENGLISH_GREETING =
  "Hi, is this Anurag? Anika from Nova Skills. You started a course registration that is still incomplete.";

test("script detection identifies authored greeting language", () => {
  assert.equal(detectScriptLanguage(TELUGU_GREETING), "te-IN");
  assert.equal(detectScriptLanguage(HINDI_GREETING), "hi-IN");
  assert.equal(detectScriptLanguage(ENGLISH_GREETING), "en-IN");
});

test("script detection returns null when there is no signal", () => {
  assert.equal(detectScriptLanguage(""), null);
  assert.equal(detectScriptLanguage("   "), null);
  assert.equal(detectScriptLanguage("42"), null);
});

test("a greeting already in the call language is left alone", () => {
  assert.equal(greetingLanguageMismatch(TELUGU_GREETING, "te-IN"), null);
  assert.equal(greetingLanguageMismatch(HINDI_GREETING, "hi-IN"), null);
  assert.equal(greetingLanguageMismatch(ENGLISH_GREETING, "en-IN"), null);
});

test("the audited failure is detected: Telugu greeting on a hi-IN call", () => {
  const mismatch = greetingLanguageMismatch(TELUGU_GREETING, "hi-IN");
  assert.deepEqual(mismatch, { source: "te-IN", target: "hi-IN" });
});

test("other audited mismatches are detected", () => {
  assert.deepEqual(greetingLanguageMismatch(TELUGU_GREETING, "en-IN"), {
    source: "te-IN",
    target: "en-IN",
  });
  assert.deepEqual(greetingLanguageMismatch(ENGLISH_GREETING, "hi-IN"), {
    source: "en-IN",
    target: "hi-IN",
  });
  assert.deepEqual(greetingLanguageMismatch(HINDI_GREETING, "en-IN"), {
    source: "hi-IN",
    target: "en-IN",
  });
});

test("an unrecognisable greeting never reports a mismatch", () => {
  assert.equal(greetingLanguageMismatch("", "hi-IN"), null);
  assert.equal(greetingLanguageMismatch("...", "te-IN"), null);
});
