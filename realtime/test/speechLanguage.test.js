import test from "node:test";
import assert from "node:assert/strict";
import { detectSpeechLanguage, looksLikeSttNoise } from "../src/speechLanguage.js";

test("Hindi request and Devanagari pin speech to Hindi", () => {
  assert.equal(detectSpeechLanguage("आपके हिंदी में बात कर सकते हो?", "te"), "hi");
  assert.equal(detectSpeechLanguage("मुझे समझ नहीं आया.", "te"), "hi");
});

test("short English STT does not switch a Hindi call to English", () => {
  assert.equal(detectSpeechLanguage("I graduate who", "hi"), null);
  assert.equal(detectSpeechLanguage("Hello?", "hi"), null);
  assert.equal(detectSpeechLanguage("No. No. No. Wire", "hi"), null);
});

test("garbled Latin during Hindi is treated as STT noise", () => {
  assert.equal(looksLikeSttNoise("I graduate who", "hi"), true);
  assert.equal(looksLikeSttNoise("No. No. No. Wire", "hi"), true);
  assert.equal(looksLikeSttNoise("Hello?", "hi"), true);
  assert.equal(looksLikeSttNoise("हां अभी वक्त है. क्या बात करनी है बताइए?", "hi"), false);
});

test("roman Hindi stays Hindi and is not treated as noise", () => {
  assert.equal(detectSpeechLanguage("kya baat karni hai bataiye", "hi"), null);
  assert.equal(looksLikeSttNoise("kya baat karni hai bataiye", "hi"), false);
});

test("a real English sentence can still switch from Hindi", () => {
  assert.equal(
    detectSpeechLanguage("please tell me about this because I do not understand the process", "hi"),
    "en"
  );
});
