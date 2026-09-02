import test from "node:test";
import assert from "node:assert/strict";
import {
  isMeaningfulBargeIn,
  isNoiseTranscript,
  normalizeVoiceTranscript,
  pcmRms,
  silenceMsFromEagerness,
} from "../src/engine/voiceSignal.js";

test("isNoiseTranscript ignores echo of agent speech", () => {
  const spoken = "Namaskaram, this is about your payment reminder.";
  assert.equal(isNoiseTranscript("Namaskaram this is about your payment", spoken), true);
  assert.equal(isNoiseTranscript("hmm", spoken), true);
  assert.equal(isNoiseTranscript("I want to register a complaint", spoken), false);
});

test("isMeaningfulBargeIn accepts real interrupts", () => {
  assert.equal(isMeaningfulBargeIn("please stop"), true);
  assert.equal(isMeaningfulBargeIn("hello"), false);
  assert.equal(isMeaningfulBargeIn("Hindi please"), true);
});

test("silence window stays in a human turn-taking range", () => {
  assert.ok(silenceMsFromEagerness(8) <= 360);
  assert.ok(silenceMsFromEagerness(9) <= 320);
  assert.ok(silenceMsFromEagerness(3) > silenceMsFromEagerness(9));
  assert.ok(silenceMsFromEagerness(4) >= 280);
});

test("pcmRms detects louder buffers", () => {
  const quiet = Buffer.alloc(320);
  const loud = Buffer.alloc(320);
  for (let i = 0; i < loud.length; i += 2) loud.writeInt16LE(8000, i);
  assert.ok(pcmRms(loud) > pcmRms(quiet));
});

test("normalizeVoiceTranscript repairs known STT corruption", () => {
  assert.equal(normalizeVoiceTranscript("Niacin साथ खोलो"), "Hindi mein baat karo");
});
