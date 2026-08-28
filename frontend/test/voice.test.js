import test from "node:test";
import assert from "node:assert/strict";

import {
  isMeaningfulBargeIn,
  isNoiseTranscript,
  normalizeVoiceTranscript,
  spokenForTts,
  stripModelControlText,
} from "../src/lib/voice.js";

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

test("short intelligible phrases qualify as barge-in", () => {
  for (const sample of [
    "Hindi please",
    "एक मिनट",
    "मेरी बात सुनो",
    "I am not interested",
    "నాకు వద్దు",
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

test("known STT corruption is repaired and filler is ignored", () => {
  assert.equal(normalizeVoiceTranscript("Niacin साथ खोलो"), "Hindi mein baat karo");
  assert.equal(isNoiseTranscript("Mm-"), true);
  assert.equal(isNoiseTranscript("hmm"), true);
});
