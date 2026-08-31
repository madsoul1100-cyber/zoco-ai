import test from "node:test";
import assert from "node:assert/strict";

import {
  detectCallerIntent,
  followCustomerLanguage,
  guardEarlyHangup,
  intentDrivenReply,
  parseSpoken,
  streamReply,
} from "../src/engine/conversation.js";
import { silenceAction } from "../src/engine/callBehavior.js";

const agent = {
  id: "agt_test_priya",
  name: "Priya",
  language: "te-IN",
  callSettings: {
    switchLanguage: true,
    autoDetectLanguage: true,
    allowedLanguages: ["te-IN", "hi-IN", "en-IN"],
  },
};

function firstTurn(text) {
  return {
    language: "te-IN",
    messages: [
      { role: "assistant", text: "నమస్కారం అండి." },
      { role: "user", text },
    ],
    gathered: {},
  };
}

test("Roman Hindi wrong-person ends immediately with the right disposition", async () => {
  const text = "Aapne galat number lagaya hai, main Ravi nahi hoon.";
  assert.equal(detectCallerIntent(text).wrongPerson, true);

  const result = await streamReply({
    agent,
    call: firstTurn(text),
    userText: text,
    onToken: () => {},
  });

  assert.equal(result.provider, "canned");
  assert.equal(result.endCall, true);
  assert.equal(result.disposition, "wrong_person");
  assert.equal(result.text, "ठीक है, धन्यवाद।");
});

test("not-graduate is not misclassified as out-of-area", () => {
  const text = "Main graduate nahi hoon, toh ye mere liye nahi hai.";
  const intent = detectCallerIntent(text);
  assert.equal(intent.notGraduate, true);
  assert.equal(intent.outOfArea, false);

  const result = intentDrivenReply({ language: "hi-IN" }, text);
  assert.equal(result.disposition, "not_interested");
  assert.match(result.text, /Graduate MLC registration/);
  assert.doesNotMatch(result.text, /क्षेत्र/);
});

test("plain-language lack of education is treated as not graduate", () => {
  const text = "I didn't study at all.";
  const intent = detectCallerIntent(text);
  assert.equal(intent.notGraduate, true);
  assert.equal(intent.outOfArea, false);
});

test("explicit Hindi switch returns a brief natural Hinglish reply", async () => {
  const text = "Mujhse Hindi mein baat kar sakti ho?";
  const call = firstTurn(text);
  const result = await streamReply({ agent, call, userText: text, onToken: () => {} });

  assert.equal(call.language, "hi-IN");
  assert.equal(result.provider, "canned");
  assert.match(result.text, /^हाँ, हिंदी में/);
  assert.match(result.text, /Graduate MLC voter registration/);
  assert.doesNotMatch(result.text, /ग्रेजुएट|एमएलसी|रजिस्ट्रेशन/);
});

test("Form 18 question is answered directly in natural Hindi/Hinglish", async () => {
  const text = "But mujhe samajh nahi aa raha ki Form 18 kya hai?";
  const call = firstTurn(text);
  const result = await streamReply({ agent, call, userText: text, onToken: () => {} });

  assert.equal(call.language, "hi-IN");
  assert.equal(result.provider, "canned");
  assert.match(result.text, /^Form 18/);
  assert.match(result.text, /voter list/);
  assert.match(result.text, /official link WhatsApp/);
});

test("spoken parser removes model prompt-label leakage and transliteration", () => {
  const result = parseSpoken(
    "VOICE STREAM: irrelevant label\nग्रेजुएट एमएलसी वोटर रजिस्ट्रेशन के फॉर्म 18 की जानकारी।",
    "hi-IN"
  );

  assert.equal(
    result.text,
    "Graduate MLC voter registration के Form 18 की जानकारी।"
  );
});

test("first-turn wrong-person disposition is permitted by hangup guard", () => {
  const result = guardEarlyHangup(
    { text: "Okay.", endCall: true, disposition: "wrong_person" },
    firstTurn("Wrong number")
  );
  assert.equal(result.endCall, true);
  assert.equal(result.disposition, "wrong_person");
});

test("specific callback request closes with callback_requested", async () => {
  const text = "Main abhi busy hoon, kal shaam ko call karna.";
  assert.equal(detectCallerIntent(text).callbackRequested, true);

  const result = await streamReply({
    agent,
    call: firstTurn(text),
    userText: text,
    onToken: () => {},
  });

  assert.equal(result.provider, "canned");
  assert.equal(result.endCall, true);
  assert.equal(result.disposition, "callback_requested");
  assert.match(result.text, /बताए समय पर कॉल/);
});

test("Priya silence nudges follow the active call language", () => {
  const configured = {
    ...agent,
    id: "agt_priya_mlc_outbound",
    callSettings: {
      nudgeEnabled: true,
      nudges: [{ message: "Hello? Are you still there?", afterSeconds: 14 }],
    },
  };
  const result = silenceAction({ language: "hi-IN", nudgeIndex: 0 }, configured);
  assert.equal(result.text, "हैलो, आप सुन रहे हैं?");
});

test("Telugu-script Hindi request switches to Hindi canned reply", async () => {
  const text = "హిందీలో మాట్లాడandi";
  const call = firstTurn(text);
  const result = await streamReply({ agent, call, userText: text, onToken: () => {} });

  assert.equal(call.language, "hi-IN");
  assert.equal(result.provider, "canned");
  assert.match(result.text, /^हाँ, हिंदी में/);
  assert.doesNotMatch(result.text, /[\u0C00-\u0C7F]/);
});

test("Devanagari Hindi request switches to Hindi canned reply", async () => {
  const text = "क्या हिंदी में बात";
  const call = firstTurn(text);
  const result = await streamReply({ agent, call, userText: text, onToken: () => {} });

  assert.equal(call.language, "hi-IN");
  assert.equal(result.provider, "canned");
  assert.match(result.text, /^हाँ, हिंदी में/);
});

test("Sarvam language hint keeps Telugu speech in Telugu despite Latin transcript", () => {
  const call = {
    language: "te-IN",
    _sttLanguageHint: "te-IN",
  };
  // Ambiguous Latin that is not clear English — STT te-IN hint wins.
  const language = followCustomerLanguage(
    call,
    agent,
    "namaskaram andi oka nimisham"
  );
  assert.equal(language, "te-IN");
  assert.equal(call.language, "te-IN");
  assert.equal("_sttLanguageHint" in call, false);
});

test("clear English speech switches off Telugu even if STT hinted te-IN", () => {
  const call = {
    language: "te-IN",
    _sttLanguageHint: "te-IN",
  };
  const language = followCustomerLanguage(
    call,
    agent,
    "Please talk in English"
  );
  assert.equal(language, "en-IN");
  assert.equal(call.languageLocked, "en-IN");
});

test("Telugu-phonetic English 'talk in hindi' switches on first turn", async () => {
  const text = "హలో కెన్ యు టాక్ ఇన్ hindi";
  const call = firstTurn(text);
  const result = await streamReply({ agent, call, userText: text, onToken: () => {} });
  assert.equal(call.language, "hi-IN");
  assert.equal(call.languageLocked, "hi-IN");
  assert.equal(result.provider, "canned");
  assert.match(result.text, /^हाँ, हिंदी में/);
});

test("mixed hindi మే baat karo switches to Hindi", async () => {
  const text = "hindi మే hindi మే బాత్ కరో hindi మే";
  const call = firstTurn(text);
  const result = await streamReply({ agent, call, userText: text, onToken: () => {} });
  assert.equal(call.language, "hi-IN");
  assert.equal(result.provider, "canned");
});

test("Telugu-script Hindi please is treated as Hindi request", () => {
  const call = {
    language: "te-IN",
    _sttLanguageHint: "te-IN",
  };
  const language = followCustomerLanguage(
    call,
    agent,
    "ప్లీజ్ హిందీ"
  );
  assert.equal(language, "hi-IN");
  assert.equal(call.languageLocked, "hi-IN");
});
