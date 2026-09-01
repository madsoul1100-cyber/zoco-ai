import test from "node:test";
import assert from "node:assert/strict";

import {
  agentUsesLiveKit,
  agentVoiceRuntime,
  bridgeAuthorized,
  isPilotAgent,
  livekitConfigured,
  livekitEnabled,
  livekitPilotOnly,
  livekitReady,
  livekitSipReady,
  mapLiveKitDisconnect,
  pilotAgentId,
  roomNameForCall,
  usesLiveKitVoice,
} from "../src/services/livekit.js";
import { rememberEvent, transcriptRelation } from "../src/engine/livekitSession.js";
import { liveKitInstructions, liveKitLanguageSwitchRule } from "../src/engine/conversation.js";

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    const next = values[key];
    if (next == null) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("pilot eligibility defaults to Priya agent id", () => {
  withEnv({ LIVEKIT_PILOT_AGENT_ID: undefined }, () => {
    assert.equal(pilotAgentId(), "agt_priya_mlc_outbound");
    assert.equal(isPilotAgent("agt_priya_mlc_outbound"), true);
    assert.equal(isPilotAgent("agt_other"), false);
  });
});

test("livekitReady requires URL, keys, and a bridge token", () => {
  withEnv({
    LIVEKIT_URL: undefined,
    LIVEKIT_API_KEY: undefined,
    LIVEKIT_API_SECRET: undefined,
    LIVEKIT_SIP_OUTBOUND_TRUNK_ID: undefined,
    LIVEKIT_BRIDGE_TOKEN: undefined,
    LIVEKIT_ENABLED: undefined,
    LIVEKIT_PILOT_ENABLED: undefined,
  }, () => {
    assert.equal(livekitReady(), false);
    process.env.LIVEKIT_URL = "wss://demo.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    assert.equal(livekitConfigured(), true);
    assert.equal(livekitReady(), true);
    assert.equal(livekitSipReady(), false);
  });
});

test("placeholder SIP trunk is not treated as ready", () => {
  withEnv({
    LIVEKIT_URL: "wss://demo.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    LIVEKIT_SIP_OUTBOUND_TRUNK_ID: "...",
    LIVEKIT_BRIDGE_TOKEN: "<shared-secret>",
  }, () => {
    assert.equal(livekitSipReady(), false);
    assert.equal(livekitReady(), true);
  });
});

test("usesLiveKitVoice covers every agent unless pilot-only is set", () => {
  withEnv({
    LIVEKIT_URL: "wss://demo.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    LIVEKIT_BRIDGE_TOKEN: "bridge",
    LIVEKIT_ENABLED: undefined,
    LIVEKIT_PILOT_ENABLED: "true",
    LIVEKIT_PILOT_ONLY: undefined,
  }, () => {
    assert.equal(livekitEnabled(), true);
    assert.equal(usesLiveKitVoice("agt_other"), true);
  });
  withEnv({
    LIVEKIT_URL: "wss://demo.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    LIVEKIT_BRIDGE_TOKEN: "bridge",
    LIVEKIT_PILOT_ONLY: "true",
    LIVEKIT_PILOT_AGENT_ID: "agt_priya_mlc_outbound",
  }, () => {
    assert.equal(livekitPilotOnly(), true);
    assert.equal(usesLiveKitVoice("agt_priya_mlc_outbound"), true);
    assert.equal(usesLiveKitVoice("agt_other"), false);
  });
});

test("mapLiveKitDisconnect maps common disconnect reasons", () => {
  assert.equal(mapLiveKitDisconnect("room_disconnected").status, "dropped");
  assert.equal(mapLiveKitDisconnect("no_answer").status, "no_answer");
  assert.equal(mapLiveKitDisconnect("busy").status, "busy");
  assert.equal(mapLiveKitDisconnect("completed").status, "completed");
});

test("roomNameForCall sanitizes call id", () => {
  assert.match(roomNameForCall("call_abc123"), /^zoco-call_abc123$/);
});

test("rememberEvent deduplicates bridge events", () => {
  const id = `evt_test_${Date.now()}`;
  assert.equal(rememberEvent(id), false);
  assert.equal(rememberEvent(id), true);
});

test("bridgeAuthorized accepts bearer and header token", () => {
  withEnv({ LIVEKIT_BRIDGE_TOKEN: "secret-bridge", LIVEKIT_API_SECRET: "secret" }, () => {
    assert.equal(
      bridgeAuthorized({ headers: { authorization: "Bearer secret-bridge" } }),
      true
    );
    assert.equal(
      bridgeAuthorized({ headers: { "x-livekit-bridge-token": "secret-bridge" } }),
      true
    );
    assert.equal(bridgeAuthorized({ headers: {} }), false);
  });
});

test("liveKitInstructions includes agent name and spoken-only rules", () => {
  const text = liveKitInstructions({
    agent: {
      name: "Priya",
      language: "te-IN",
      useCase: "MLC awareness",
      successCriteria: "Explain Form 18",
      greeting: "Namaskaram",
      instructions: "Stay brief.",
    },
    customer: { name: "Ravi", phone: "+919999999999" },
  });
  assert.match(text, /Priya/);
  assert.match(text, /Ravi/);
  assert.match(text, /spoken words/i);
  assert.match(text, /talk in English/i);
  assert.match(text, /LANGUAGE SWITCH/i);
  assert.match(text, /SPOKEN LENGTH/i);
});

test("liveKitLanguageSwitchRule ignores garbled English STT", () => {
  const rule = liveKitLanguageSwitchRule({ language: "te-IN" });
  assert.match(rule, /I graduate who/);
  assert.match(rule, /not_interested/i);
});

test("liveKitLanguageSwitchRule stays locked when switching is disabled", () => {
  const locked = liveKitLanguageSwitchRule({
    language: "te-IN",
    callSettings: { switchLanguage: false },
  });
  assert.match(locked, /Stay in Telugu/i);
  assert.doesNotMatch(locked, /talk in English/i);
});

test("agentVoiceRuntime honors LiveKit vs Personalized and defaults from env gating", () => {
  withEnv({
    LIVEKIT_URL: "wss://demo.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    LIVEKIT_BRIDGE_TOKEN: "bridge",
    LIVEKIT_ENABLED: "true",
    LIVEKIT_PILOT_ONLY: undefined,
  }, () => {
    assert.equal(agentVoiceRuntime({ id: "agt_other" }), "livekit");
    assert.equal(agentVoiceRuntime({ id: "agt_other", voiceRuntime: "personalized" }), "personalized");
    assert.equal(agentVoiceRuntime({ id: "agt_other", voiceRuntime: "livekit" }), "livekit");
    assert.equal(agentVoiceRuntime({ id: "agt_other", voiceRuntime: "pipecat" }), "pipecat");
    assert.equal(agentUsesLiveKit({ id: "agt_other", voiceRuntime: "personalized" }), false);
    assert.equal(agentUsesLiveKit({ id: "agt_other", voiceRuntime: "livekit" }), true);
  });
  withEnv({
    LIVEKIT_URL: "wss://demo.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    LIVEKIT_BRIDGE_TOKEN: "bridge",
    LIVEKIT_ENABLED: "false",
  }, () => {
    assert.equal(agentUsesLiveKit({ id: "agt_other", voiceRuntime: "livekit" }), false);
  });
});

test("transcriptRelation merges LiveKit STT extensions instead of duplicating", () => {
  assert.equal(transcriptRelation("नमस्ते", "नमस्ते"), "same");
  assert.equal(transcriptRelation("मेरी बात", "मेरी बात सुनो"), "extend");
  assert.equal(transcriptRelation("मेरी बात सुनो", "मेरी बात"), "shorter");
  assert.equal(transcriptRelation("hello", "namaskaram"), "new");
  assert.equal(transcriptRelation("क्या आप हिंदी बात कर सकते", "हो?"), "join");
  assert.equal(transcriptRelation("hello", "namaskaram", { consecutive: false }), "new");
});
