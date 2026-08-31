import test from "node:test";
import assert from "node:assert/strict";

import {
  bridgeAuthorized,
  isPilotAgent,
  livekitReady,
  mapLiveKitDisconnect,
  pilotAgentId,
  pilotEnabled,
  roomNameForCall,
} from "../src/services/livekit.js";
import { rememberEvent } from "../src/engine/livekitSession.js";

test("pilot eligibility defaults to Priya agent id", () => {
  const previous = process.env.LIVEKIT_PILOT_ENABLED;
  const previousAgent = process.env.LIVEKIT_PILOT_AGENT_ID;
  process.env.LIVEKIT_PILOT_ENABLED = "true";
  delete process.env.LIVEKIT_PILOT_AGENT_ID;
  assert.equal(pilotAgentId(), "agt_priya_mlc_outbound");
  assert.equal(isPilotAgent("agt_priya_mlc_outbound"), true);
  assert.equal(isPilotAgent("agt_other"), false);
  process.env.LIVEKIT_PILOT_ENABLED = previous;
  if (previousAgent) process.env.LIVEKIT_PILOT_AGENT_ID = previousAgent;
});

test("livekitReady requires core env vars", () => {
  const saved = {
    LIVEKIT_URL: process.env.LIVEKIT_URL,
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
    LIVEKIT_SIP_OUTBOUND_TRUNK_ID: process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID,
    LIVEKIT_BRIDGE_TOKEN: process.env.LIVEKIT_BRIDGE_TOKEN,
  };
  delete process.env.LIVEKIT_URL;
  assert.equal(livekitReady(), false);
  process.env.LIVEKIT_URL = "wss://demo.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "key";
  process.env.LIVEKIT_API_SECRET = "secret";
  process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID = "ST_abc";
  process.env.LIVEKIT_BRIDGE_TOKEN = "bridge-token";
  assert.equal(livekitReady(), true);
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
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
  const previous = process.env.LIVEKIT_BRIDGE_TOKEN;
  process.env.LIVEKIT_BRIDGE_TOKEN = "secret-bridge";
  assert.equal(
    bridgeAuthorized({ headers: { authorization: "Bearer secret-bridge" } }),
    true
  );
  assert.equal(
    bridgeAuthorized({ headers: { "x-livekit-bridge-token": "secret-bridge" } }),
    true
  );
  assert.equal(bridgeAuthorized({ headers: {} }), false);
  if (previous) process.env.LIVEKIT_BRIDGE_TOKEN = previous;
  else delete process.env.LIVEKIT_BRIDGE_TOKEN;
});
