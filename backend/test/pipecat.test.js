import test from "node:test";
import assert from "node:assert/strict";

import { agentVoiceRuntime, persistVoiceRuntime } from "../src/services/livekit.js";
import {
  agentUsesPipecat,
  pipecatBridgeAuthorized,
  pipecatConfigured,
  pipecatDialReady,
  pipecatEnabled,
  pipecatMode,
  pipecatReady,
  pipecatSessionBody,
  publicPipecatStatus,
  startPipecatWebSession,
} from "../src/services/pipecat.js";

const CLOUD_OFF = {
  PIPECAT_CLOUD_PUBLIC_KEY: undefined,
  PIPECAT_CLOUD_PRIVATE_KEY: undefined,
  PIPECAT_PUBLIC_API_KEY: undefined,
  PIPECAT_PRIVATE_API_KEY: undefined,
  PIPECAT_API_KEY: undefined,
  PIPECAT_CLOUD_AGENT_NAME: undefined,
  PIPECAT_AGENT_NAME: undefined,
};

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    const next = values[key];
    if (next == null) delete process.env[key];
    else process.env[key] = next;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("pipecat is off unless a worker URL, ENABLED, or Cloud public key is set", () => {
  withEnv({
    ...CLOUD_OFF,
    PIPECAT_URL: undefined,
    PIPECAT_PUBLIC_URL: undefined,
    PIPECAT_ENABLED: undefined,
    PIPECAT_BRIDGE_TOKEN: undefined,
    LIVEKIT_BRIDGE_TOKEN: undefined,
    LIVEKIT_API_SECRET: undefined,
    DAILY_API_KEY: undefined,
  }, () => {
    assert.equal(pipecatConfigured(), false);
    assert.equal(pipecatReady(), false);
    assert.equal(pipecatEnabled(), false);
    assert.equal(pipecatMode(), "off");
  });
});

test("pipecatReady requires an explicit worker URL and a bridge token", () => {
  withEnv({
    ...CLOUD_OFF,
    PIPECAT_URL: "http://127.0.0.1:7860",
    PIPECAT_ENABLED: undefined,
    PIPECAT_BRIDGE_TOKEN: undefined,
    LIVEKIT_BRIDGE_TOKEN: undefined,
    LIVEKIT_API_SECRET: "secret",
    DAILY_API_KEY: undefined,
  }, () => {
    assert.equal(pipecatConfigured(), true);
    assert.equal(pipecatReady(), true);
    assert.equal(pipecatDialReady(), false);
    assert.equal(pipecatEnabled(), true);
    assert.equal(pipecatMode(), "local");
  });
});

test("Cloud public key makes Pipecat ready without a local worker URL", () => {
  withEnv({
    ...CLOUD_OFF,
    PIPECAT_CLOUD_PUBLIC_KEY: "pk_test",
    PIPECAT_CLOUD_AGENT_NAME: "zoco-voice",
    PIPECAT_URL: undefined,
    PIPECAT_ENABLED: undefined,
    LIVEKIT_API_SECRET: "secret",
    DAILY_API_KEY: undefined,
  }, () => {
    assert.equal(pipecatConfigured(), true);
    assert.equal(pipecatReady(), true);
    assert.equal(pipecatDialReady(), true);
    assert.equal(pipecatMode(), "cloud");
    const status = publicPipecatStatus();
    assert.equal(status.mode, "cloud");
    assert.equal(status.transport, "daily");
    assert.equal(status.cloud.configured, true);
    assert.equal(status.cloud.publicKey, true);
  });
});

test("pipecatDialReady needs a Daily API key for the local worker", () => {
  withEnv({
    ...CLOUD_OFF,
    PIPECAT_URL: "http://127.0.0.1:7860",
    PIPECAT_BRIDGE_TOKEN: "bridge",
    DAILY_API_KEY: "daily-key",
  }, () => {
    assert.equal(pipecatDialReady(), true);
  });
});

test("agentUsesPipecat honors voiceRuntime and enabled flag", () => {
  withEnv({
    ...CLOUD_OFF,
    PIPECAT_URL: "http://127.0.0.1:7860",
    PIPECAT_BRIDGE_TOKEN: "bridge",
    PIPECAT_ENABLED: "true",
  }, () => {
    assert.equal(agentVoiceRuntime({ voiceRuntime: "pipecat" }), "pipecat");
    assert.equal(agentUsesPipecat({ voiceRuntime: "pipecat" }), true);
    assert.equal(agentUsesPipecat({ voiceRuntime: "livekit" }), false);
    assert.equal(persistVoiceRuntime("pipecat"), "pipecat");
  });
  withEnv({
    ...CLOUD_OFF,
    PIPECAT_URL: "http://127.0.0.1:7860",
    PIPECAT_BRIDGE_TOKEN: "bridge",
    PIPECAT_ENABLED: "false",
  }, () => {
    assert.equal(agentUsesPipecat({ voiceRuntime: "pipecat" }), false);
  });
});

test("pipecat bridge accepts bearer and header token", () => {
  withEnv({
    ...CLOUD_OFF,
    PIPECAT_BRIDGE_TOKEN: "secret-bridge",
    PIPECAT_URL: "http://127.0.0.1:7860",
  }, () => {
    assert.equal(
      pipecatBridgeAuthorized({ headers: { authorization: "Bearer secret-bridge" } }),
      true
    );
    assert.equal(
      pipecatBridgeAuthorized({ headers: { "x-pipecat-bridge-token": "secret-bridge" } }),
      true
    );
    assert.equal(pipecatBridgeAuthorized({ headers: {} }), false);
  });
});

test("startPipecatWebSession uses Cloud start and returns Daily room credentials", async () => {
  await withEnv({
    ...CLOUD_OFF,
    PIPECAT_CLOUD_PUBLIC_KEY: "pk_test",
    PIPECAT_CLOUD_AGENT_NAME: "zoco-voice",
    PIPECAT_BRIDGE_TOKEN: "bridge",
    ZOCO_BRIDGE_URL: "https://voice.example.com",
  }, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      assert.equal(String(url), "https://api.pipecat.daily.co/v1/public/zoco-voice/start");
      const payload = JSON.parse(opts.body);
      assert.equal(payload.createDailyRoom, true);
      assert.equal(payload.transport, "daily");
      assert.equal(payload.body.callId, "call_9");
      assert.equal(payload.body.agentId, "agt_9");
      assert.equal(payload.body.channel, "web");
      assert.equal(payload.body.bridgeUrl, "https://voice.example.com");
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            sessionId: "sess-9",
            dailyRoom: "https://room.daily.co/abc",
            dailyToken: "daily-tok",
          });
        },
      };
    };
    try {
      const session = await startPipecatWebSession(
        { id: "call_9" },
        { id: "agt_9" }
      );
      assert.equal(session.mode, "cloud");
      assert.equal(session.transport, "daily");
      assert.equal(session.sessionId, "sess-9");
      assert.equal(session.dailyRoom, "https://room.daily.co/abc");
      assert.equal(session.dailyToken, "daily-tok");
      assert.equal(session.startUrl, undefined);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

test("Cloud Service not found falls back to the local worker start URL", async () => {
  await withEnv({
    ...CLOUD_OFF,
    PIPECAT_CLOUD_PUBLIC_KEY: "pk_test",
    PIPECAT_CLOUD_AGENT_NAME: "zoco-voice",
    PIPECAT_URL: "http://127.0.0.1:7860",
    PIPECAT_BRIDGE_TOKEN: "bridge",
  }, async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ error: "Service not found", code: "404" });
      },
    });
    try {
      const session = await startPipecatWebSession({ id: "call_local" }, { id: "agt_local" });
      assert.equal(session.mode, "local");
      assert.equal(session.startUrl, "http://127.0.0.1:7860/start");
      assert.equal(session.transport, "webrtc");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

test("session body carries call, agent, and optional PSTN fields", () => {
  withEnv({ ZOCO_BRIDGE_URL: "https://bridge.example" }, () => {
    const body = pipecatSessionBody(
      { id: "call_1" },
      { id: "agt_1" },
      { channel: "telephony", phone: "+919800000000", fromNumber: "+918000000000" }
    );
    assert.equal(body.callId, "call_1");
    assert.equal(body.phone, "+919800000000");
    assert.equal(body.fromNumber, "+918000000000");
    assert.equal(body.bridgeUrl, "https://bridge.example");
  });
});
