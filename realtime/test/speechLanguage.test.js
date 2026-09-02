import test from "node:test";
import assert from "node:assert/strict";
import { detectSpeechLanguage, isLikelyAgentEcho, looksLikeSttNoise } from "../src/speechLanguage.js";

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

test("short English STT fragments are treated as noise on English calls", () => {
  assert.equal(looksLikeSttNoise("Aankhen", "en"), true);
  assert.equal(looksLikeSttNoise("you are not", "en"), true);
  assert.equal(looksLikeSttNoise("I am saying any", "en"), true);
  assert.equal(looksLikeSttNoise("yes", "en"), false);
  assert.equal(looksLikeSttNoise("I want the weekend batch please", "en"), false);
});

test("agent greeting echo is ignored, including CarePoint Hindi bleed", () => {
  const greeting =
    "नमस्ते, क्या मैं Ravi जी से बात कर रही हूँ? मैं CarePoint Clinic से Meera हूँ। आपके appointment के बारे में कॉल किया है, क्या एक मिनट है?";
  assert.equal(isLikelyAgentEcho("मैं केयर प्वाइंट", greeting), true);
  assert.equal(isLikelyAgentEcho("CarePoint Clinic", greeting), true);
  assert.equal(isLikelyAgentEcho("हाँ, बताइए appointment कब है", greeting), false);
});
