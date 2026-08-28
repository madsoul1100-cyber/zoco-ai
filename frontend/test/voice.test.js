import test from "node:test";
import assert from "node:assert/strict";

import { isMeaningfulBargeIn } from "../src/lib/voice.js";

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
