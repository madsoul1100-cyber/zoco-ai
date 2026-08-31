import test from "node:test";
import assert from "node:assert/strict";

import {
  isLanguageSwitchCommand,
  isLikelyAgentEcho,
  isMeaningfulBargeIn,
  isNoiseTranscript,
  isUrgentUserCommand,
  normalizeVoiceTranscript,
  spokenForTts,
  stripModelControlText,
} from "../src/lib/voice.js";

const GREETING =
  "హలో, Manan గారితోనే మాట్లాడుతున్నానా? అమర్నాథ్ సారంగుల గారి టీమ్ నుంచి వాయిస్ అసిస్టెంట్ ప్రియా మాట్లాడుతున్నాను. ఒక ముప్పై సెకన్లు మాట్లాడొచ్చా?";

test("vibration and isolated background sounds do not qualify as barge-in", () => {
  for (const sample of ["", "…", "hmm", "uh", "hello", "क्या", "background"]) {
    assert.equal(isMeaningfulBargeIn(sample), false, sample);
  }
});

test("explicit stop commands can interrupt immediately", () => {
  for (const sample of ["stop", "please stop", "रुको", "बस", "नहीं", "ఆపు", "వద్దు"]) {
    assert.equal(isMeaningfulBargeIn(sample), true, sample);
  }
});

test("Hindi language switch is urgent; agent Telugu greeting words are not", () => {
  assert.equal(isLanguageSwitchCommand("Hindi mein baat kariye"), true);
  assert.equal(isLanguageSwitchCommand("क्या हिंदी में बात"), true);
  assert.equal(isUrgentUserCommand("Hindi mein baat kariye"), true);
  assert.equal(isUrgentUserCommand("మాట్లాడొచ్చా"), false);
  assert.equal(isUrgentUserCommand("ప్రియా మాట్లాడుతున్నాను"), false);
});

test("agent TTS echo is ignored as noise / barge", () => {
  assert.equal(isLikelyAgentEcho("మాట్లాడొచ్చా", GREETING), true);
  assert.equal(isNoiseTranscript("ప్రియా మాట్లాడుతున్నాను", GREETING), true);
  assert.equal(isLikelyAgentEcho("Hindi mein baat kariye", GREETING), false);
});

test("short intelligible phrases qualify as barge-in", () => {
  for (const sample of [
    "Hindi please",
    "मेरी बात सुनो",
    "I am not interested",
  ]) {
    assert.equal(isMeaningfulBargeIn(sample), true, sample);
  }
});

test("model control and knowledge-query text is never shown or spoken", () => {
  assert.equal(
    stripModelControlText("Knowledge Base Query: What does Form 18 mean?\nForm 18 is a registration form."),
    "Form 18 is a registration form."
  );
  assert.equal(stripModelControlText("VOICE STREAM: preparing answer"), "");
  assert.equal(
    spokenForTts('Knowledge Base Query: What does "graduate" mean? A graduate has completed a degree.'),
    "A graduate has completed a degree."
  );
});

test("Telugu-script hindi please normalizes to Hindi switch", () => {
  assert.equal(normalizeVoiceTranscript("ప్లీజ్ హిందీ"), "Hindi mein baat kariye");
  assert.equal(isLanguageSwitchCommand("ప్లీజ్ హిందీ"), true);
  assert.equal(normalizeVoiceTranscript("please english"), "Please talk in English");
});

test("known STT corruption is repaired and filler is ignored", () => {
  assert.equal(normalizeVoiceTranscript("Niacin साथ खोलो"), "Hindi mein baat karo");
  assert.equal(isNoiseTranscript("Mm-"), true);
  assert.equal(isNoiseTranscript("hmm"), true);
});
