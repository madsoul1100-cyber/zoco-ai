import test from "node:test";
import assert from "node:assert/strict";
import {
  detectExplicitLanguageSwitch,
  detectSpeechLanguage,
  grantsTalkTime,
  hasClosingTail,
  hasOpenLanguageTail,
  isEllipticalAffirmation,
  isIncompleteUserUtterance,
  isListeningComplaint,
  isLikelyAgentEcho,
  isNotSpeakingCue,
  isPurposeQuestion,
  isSubstantiveUserTurn,
  isUserBackchannel,
  looksLikeSttNoise,
  softListenPrompt,
  wantsAgentToContinue,
} from "../src/speechLanguage.js";
import { decideUserTurn } from "../src/sessionTuning.js";

test("Hindi request and Devanagari pin speech to Hindi", () => {
  assert.equal(detectSpeechLanguage("आपके हिंदी में बात कर सकते हो?", "te"), "hi");
  assert.equal(detectSpeechLanguage("मुझे समझ नहीं आया.", "te"), "hi");
  assert.equal(detectExplicitLanguageSwitch("मुझ हिंदी में बात करो"), "hi");
});

test("Telugu-script STT of Hindi request still switches to Hindi", () => {
  // Live log: Deepgram te heard "हिंदी में बात करो" as Telugu phonetics
  assert.equal(
    detectExplicitLanguageSwitch("చెప్పాపకు మేము బోలరాముకి హిందీవే బాతకరు"),
    "hi"
  );
});

test("after Hindi lock, Telugu script must not flip STT back to Telugu", () => {
  assert.equal(
    detectSpeechLanguage("యా గీ head, but periya బార్డర్ తెలుగు", "hi", { locked: true }),
    null
  );
  assert.equal(detectSpeechLanguage("అది", "hi", { locked: true }), null);
});

test("short English STT does not switch a Hindi call to English", () => {
  assert.equal(detectSpeechLanguage("I graduate who", "hi"), null);
  assert.equal(detectSpeechLanguage("Hello?", "hi"), null);
  assert.equal(detectSpeechLanguage("No. No. No. Wire", "hi"), null);
});

test("garbled Latin during Hindi is treated as STT noise", () => {
  assert.equal(looksLikeSttNoise("I graduate who", "hi"), true);
  assert.equal(looksLikeSttNoise("No. No. No. Wire", "hi"), true);
  assert.equal(isUserBackchannel("Hello?"), true);
  assert.equal(looksLikeSttNoise("Hello?", "hi"), false);
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
  assert.equal(detectExplicitLanguageSwitch("I don't understand Telugu, talk in English"), "en");
});

// voice-closing-tail-v1 — from call_592cdbc6-d: the caller signed off and got
// "I didn't catch that completely. Could you please repeat?" instead of a goodbye.
test("a sign-off wrapped in filler is a complete turn, not a cut-off phrase", () => {
  assert.equal(hasClosingTail("Yeah. Yeah. Okay, Thank you."), true);
  assert.equal(isIncompleteUserUtterance("Yeah. Yeah. Okay, Thank you."), false);
  assert.equal(
    decideUserTurn("Yeah. Yeah. Okay, Thank you.", { ttsLanguage: "en", lastSpoken: "Anika here" }),
    "reply"
  );
  for (const line of ["Okay thank you", "Yeah okay thanks", "Alright, that is all. Goodbye.", "ठीक है, धन्यवाद"]) {
    assert.equal(
      decideUserTurn(line, { ttsLanguage: "en", lastSpoken: "Anika here" }),
      "reply",
      `expected a reply for: ${line}`
    );
  }
});

test("closing-tail detection does not swallow genuinely cut-off speech", () => {
  assert.equal(hasClosingTail("what type of"), false);
  assert.equal(hasClosingTail("Yeah. Go ahead. Send me the link."), false);
  // Still coalesced, so the earlier mid-sentence fixes keep working.
  assert.equal(decideUserTurn("what type of", { ttsLanguage: "en" }), "noise_repair");
  assert.equal(decideUserTurn("hello are", { ttsLanguage: "en" }), "noise_repair");
  assert.equal(decideUserTurn("some test company’s", { ttsLanguage: "en" }), "noise_repair");
});

// voice-language-switch-negation-v1 — real caller lines from the Sep 2026 call audit.
test("a rejected language is never the language we switch to", () => {
  // Names both languages: asks for English, rejects Hindi.
  assert.equal(
    detectExplicitLanguageSwitch("talk in English because I don't understand hindi that much."),
    "en"
  );
  // Asks for Hindi, rejects Telugu — the reject must not win just by appearing later.
  assert.equal(
    detectExplicitLanguageSwitch("आप हिंदी में बात कर सकते हैं? मुझे तेलुगु समझ नहीं आती।"),
    "hi"
  );
  // Rejection first, request second.
  assert.equal(
    detectExplicitLanguageSwitch("तेलुगु समझ नहीं आती। आप हिंदी में बात करिए।"),
    "hi"
  );
});

test("a rejection with no explicit request falls back to the caller's own script", () => {
  assert.equal(detectExplicitLanguageSwitch("मुझे तेलुगु समझ नहीं आती"), "hi");
  assert.equal(detectExplicitLanguageSwitch("तमिल समझ नहीं आती तेलुगु जो भी है"), "hi");
});

test("an unresolvable rejection does not guess a language", () => {
  // Caller rejects English while speaking English — no safe target to pick.
  assert.equal(detectExplicitLanguageSwitch("I do not understand English"), null);
  // "my language" names nothing we can act on.
  assert.equal(
    detectExplicitLanguageSwitch("आप बोल क्या रहे हो मुझे समझ नहीं आ रहा है. क्या आप मेरी भाषा में बात कर सकते हो?"),
    null
  );
});

test("a language-switch request is always answered, never swallowed as noise", () => {
  // These waited 8-22s in silence before this fix, on te-IN calls.
  for (const line of [
    "आप हिंदी में बात कर सकते हैं? मुझे तेलुगु समझ नहीं आती।",
    "क्या आप हिंदी में बात कर सकते हो?",
    "तेलुगु समझ नहीं आती। आप हिंदी में बात करिए।",
    "talk in English because I don't understand hindi that much.",
  ]) {
    assert.equal(
      decideUserTurn(line, { ttsLanguage: "te", lastSpoken: "హలో" }),
      "reply",
      `expected a reply for: ${line}`
    );
  }
});

test("short English STT fragments are treated as noise on English calls", () => {
  assert.equal(looksLikeSttNoise("Aankhen", "en"), true);
  assert.equal(looksLikeSttNoise("you are not", "en"), true);
  assert.equal(looksLikeSttNoise("I am saying any", "en"), true);
  assert.equal(looksLikeSttNoise("yes", "en"), false);
  assert.equal(looksLikeSttNoise("I want the weekend batch please", "en"), false);
});

test("listening backchannels are not STT noise", () => {
  for (const sample of [
    "Mmm.",
    "Hmm",
    "Okay.",
    "Mm-hmm",
    "uh huh",
    "haan",
    "Go on.",
    "Are you saying something?",
    "Hello?",
  ]) {
    assert.equal(isUserBackchannel(sample), true, sample);
    assert.equal(looksLikeSttNoise(sample, "en"), false, sample);
    assert.equal(looksLikeSttNoise(sample, "hi"), false, sample);
  }
  assert.equal(isUserBackchannel("I would like to complete my registration."), false);
});

test("greeting opener नमस्ते from speaker bleed is agent echo", () => {
  const greeting =
    "नमस्ते, क्या मैं Ravi जी से बात कर रही हूँ? मैं CarePoint Clinic से Meera हूँ। आपके appointment के बारे में कॉल किया है, क्या एक मिनट है?";
  assert.equal(isLikelyAgentEcho("नमस्ते", greeting), true);
  assert.equal(isLikelyAgentEcho("speakingनमस्ते", greeting), true);
  assert.equal(isLikelyAgentEcho("क्या मैं Ravi जी से बात", greeting), true);
  assert.equal(isLikelyAgentEcho("CarePoint Clinic से Meera", greeting), true);
  assert.equal(isLikelyAgentEcho("हाँ, बताइए appointment कब है", greeting), false);
});

test("substantive caller speech is never treated as agent echo", () => {
  const spoken =
    "Once you upload your document, would you like me to help you pick a weekend batch?";
  assert.equal(isSubstantiveUserTurn("Yes I want the weekend batch please"), true);
  assert.equal(isLikelyAgentEcho("Yes I want the weekend batch please", spoken), false);
  assert.equal(isLikelyAgentEcho("weekend batch please", spoken), false);
  const whatsappSpoken =
    "My apologies, I'll send that WhatsApp link to you right now. Once you upload your document, would you like me to help you pick a batch?";
  assert.equal(isLikelyAgentEcho("WhatsApp link", whatsappSpoken), true);
});

test("cut-off English phrases are incomplete — agent must not reply yet", () => {
  for (const sample of ["hello are", "what type of", "don't", "I am"]) {
    assert.equal(isIncompleteUserUtterance(sample), true, sample);
    assert.equal(looksLikeSttNoise(sample, "en"), true, sample);
  }
  assert.equal(isIncompleteUserUtterance("Yes I want to complete my registration."), false);
  assert.equal(isIncompleteUserUtterance("Yes."), false);
});

// voice-elliptical-affirmation-v1 — Priya: "Yes, I have." must answer the prior question.
test("elliptical yes/no answers are complete replies with prior-question context", () => {
  for (const line of ["Yes, I have.", "Yes, I am.", "No, I don't.", "Yes I have", "Yes. I have. Please"]) {
    assert.equal(isEllipticalAffirmation(line) || grantsTalkTime(line), true, line);
    assert.equal(isIncompleteUserUtterance(line), false, line);
    assert.equal(
      decideUserTurn(line, {
        ttsLanguage: "en",
        lastSpoken: "Do you have a degree from a recognized university?",
      }),
      "reply",
      line
    );
  }
  assert.equal(
    decideUserTurn("talk in English? Yes. Go ahead.", {
      ttsLanguage: "en",
      lastSpoken: "Am I speaking with Manan, and do you have thirty seconds?",
    }),
    "reply"
  );
});

// voice-purpose-question-v1 — call_d99d3a05-2 Anika treated this as noise and asked to repeat.
test("yes + have a minute + what is about is a complete reply turn", () => {
  const line = "Yes. Have a minute. What is about?";
  assert.equal(isPurposeQuestion(line), true);
  assert.equal(grantsTalkTime(line), true);
  assert.equal(isIncompleteUserUtterance(line), false);
  assert.equal(
    decideUserTurn(line, {
      ttsLanguage: "en",
      lastSpoken: "Hi Ravi, this is Anika from Nova Skills about your incomplete registration — got a minute?",
    }),
    "reply"
  );
  assert.equal(isIncompleteUserUtterance("Yes. Have a minute. What is this about?"), false);
  assert.equal(isListeningComplaint("I can repeat, but I think you are not listening to me."), true);
  assert.equal(
    decideUserTurn("I can repeat, but I think you are not listening to me.", {
      ttsLanguage: "en",
      lastSpoken: "Sorry — go ahead, I'm listening.",
    }),
    "reply"
  );
});

// voice-human-listen-v1 — soft continue / not-speaking cues, not robotic repeat prompts.
test("continue and not-speaking cues behave like a human listener", () => {
  assert.equal(wantsAgentToContinue("No no continue"), true);
  assert.equal(wantsAgentToContinue("go on"), true);
  assert.equal(isNotSpeakingCue("I'm not saying anything"), true);
  assert.equal(isNotSpeakingCue("never mind"), true);
  assert.equal(
    decideUserTurn("No no continue", {
      ttsLanguage: "en",
      lastSpoken: "Your registration is incomplete",
    }),
    "reply"
  );
  assert.equal(
    decideUserTurn("I'm not saying anything", {
      ttsLanguage: "en",
      lastSpoken: "Your registration is incomplete",
    }),
    "ignore"
  );
  assert.equal(softListenPrompt("en"), "Sorry — go ahead, I'm listening.");
  assert.match(softListenPrompt("hi"), /सुन/);
});

// voice-hindi-open-tail-v1 — studio bug: agent replied to "कोई टेस्टकंपनी का"
test("Hindi genitive cutoff stays incomplete even with spaced words", () => {
  for (const sample of ["कोई टेस्टकंपनी का", "कोई टेस्ट कंपनी का", "Nova Skills का"]) {
    assert.equal(hasOpenLanguageTail(sample), true, sample);
    assert.equal(isIncompleteUserUtterance(sample), true, sample);
    assert.equal(
      decideUserTurn(sample, { ttsLanguage: "hi", lastSpoken: "पेमेंट बाकी है" }),
      "noise_repair",
      sample
    );
  }
  assert.equal(isIncompleteUserUtterance("कोई टेस्ट कंपनी का नाम Nova Skills है।"), false);
  assert.equal(
    decideUserTurn("कोई टेस्ट कंपनी का नाम Nova Skills है।", {
      ttsLanguage: "hi",
      lastSpoken: "पेमेंट बाकी है",
    }),
    "reply"
  );
  // Complete "what happened" must still reply
  assert.equal(hasOpenLanguageTail("Kyon kya hua"), false);
  // English mid-cut (if STT stays in English)
  assert.equal(isIncompleteUserUtterance("some test company's"), true);
  assert.equal(isIncompleteUserUtterance("some test company of"), true);
  assert.equal(
    decideUserTurn("some test company's", { ttsLanguage: "en", lastSpoken: "Hi" }),
    "noise_repair"
  );
});

test("agent-busy bleed is dropped unless caller is really interrupting", () => {
  const spoken =
    "Would you like to schedule your appointment for Saturday morning?";
  assert.equal(isLikelyAgentEcho("schedule your appointment", spoken), true);
});

test("agent greeting echo is ignored, including CarePoint Hindi bleed", () => {
  const greeting =
    "नमस्ते, क्या मैं Ravi जी से बात कर रही हूँ? मैं CarePoint Clinic से Meera हूँ। आपके appointment के बारे में कॉल किया है, क्या एक मिनट है?";
  assert.equal(isLikelyAgentEcho("मैं केयर प्वाइंट", greeting), true);
  assert.equal(isLikelyAgentEcho("CarePoint Clinic", greeting), true);
  assert.equal(isLikelyAgentEcho("हाँ, बताइए appointment कब है", greeting), false);
});
