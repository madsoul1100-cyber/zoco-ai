import test from "node:test";
import assert from "node:assert/strict";

import {
  PipecatCloudError,
  cloudRequest,
  createAgent,
  createBuild,
  deleteAgent,
  deleteSecret,
  deleteSecretSet,
  getAgent,
  getAgentLogs,
  getBuild,
  getBuildLogs,
  getProperties,
  getPropertiesSchema,
  getSecretSet,
  getSession,
  getUploadUrl,
  listAgents,
  listBuilds,
  listRegions,
  listSecrets,
  listSessions,
  pipecatCloudConfig,
  pipecatCloudConfigured,
  pipecatCloudPrivateReady,
  publicPipecatCloudStatus,
  sessionProxy,
  startSession,
  stopSession,
  updateAgent,
  updateProperties,
  upsertSecretSet,
} from "../src/services/pipecatCloud.js";

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

function mockFetch(handler) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const next = { url: String(url), method: opts.method || "GET", headers: opts.headers || {}, body: opts.body };
    calls.push(next);
    return handler(next);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = orig;
    },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

test("cloud is off without a public API key", () => {
  withEnv({
    PIPECAT_CLOUD_PUBLIC_KEY: undefined,
    PIPECAT_PUBLIC_API_KEY: undefined,
    PIPECAT_API_KEY: undefined,
    PIPECAT_CLOUD_PRIVATE_KEY: undefined,
    PIPECAT_PRIVATE_API_KEY: undefined,
  }, () => {
    assert.equal(pipecatCloudConfigured(), false);
    assert.equal(pipecatCloudPrivateReady(), false);
  });
});

test("pk_ generic key is treated as the public Cloud key", () => {
  withEnv({
    PIPECAT_CLOUD_PUBLIC_KEY: undefined,
    PIPECAT_PUBLIC_API_KEY: undefined,
    PIPECAT_API_KEY: "pk_live_abc",
    PIPECAT_CLOUD_PRIVATE_KEY: "sk_live_xyz",
    PIPECAT_CLOUD_AGENT_NAME: "zoco-voice",
  }, () => {
    const cfg = pipecatCloudConfig();
    assert.equal(cfg.publicKey, "pk_live_abc");
    assert.equal(cfg.privateKey, "sk_live_xyz");
    assert.equal(cfg.agentName, "zoco-voice");
    assert.equal(pipecatCloudConfigured(), true);
    assert.equal(pipecatCloudPrivateReady(), true);
    assert.equal(cfg.publicBase, "https://api.pipecat.daily.co/v1/public");
    assert.equal(cfg.privateBase, "https://api.pipecat.daily.co/v1");
  });
});

test("public status never includes key material", () => {
  withEnv({
    PIPECAT_CLOUD_PUBLIC_KEY: "pk_secret",
    PIPECAT_CLOUD_PRIVATE_KEY: "sk_secret",
    PIPECAT_CLOUD_AGENT_NAME: "voice-starter",
  }, () => {
    const status = publicPipecatCloudStatus();
    assert.equal(status.configured, true);
    assert.equal(status.publicKey, true);
    assert.equal(status.privateKey, true);
    assert.equal(status.agentName, "voice-starter");
    assert.equal(JSON.stringify(status).includes("pk_secret"), false);
    assert.equal(JSON.stringify(status).includes("sk_secret"), false);
  });
});

test("startSession POSTs to the public /{agent}/start endpoint", async () => {
  await withEnv({
    PIPECAT_CLOUD_PUBLIC_KEY: "pk_test",
    PIPECAT_CLOUD_AGENT_NAME: "zoco-voice",
  }, async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, {
      sessionId: "sid-1",
      dailyRoom: "https://example.daily.co/room",
      dailyToken: "tok",
    }));
    try {
      const data = await startSession("zoco-voice", {
        createDailyRoom: true,
        transport: "daily",
        body: { callId: "call_1", agentId: "agt_1" },
      });
      assert.equal(fetchMock.calls.length, 1);
      assert.equal(fetchMock.calls[0].url, "https://api.pipecat.daily.co/v1/public/zoco-voice/start");
      assert.equal(fetchMock.calls[0].method, "POST");
      assert.equal(fetchMock.calls[0].headers.Authorization, "Bearer pk_test");
      const payload = JSON.parse(fetchMock.calls[0].body);
      assert.equal(payload.createDailyRoom, true);
      assert.equal(payload.body.callId, "call_1");
      assert.equal(data.sessionId, "sid-1");
      assert.equal(data.dailyRoom, "https://example.daily.co/room");
    } finally {
      fetchMock.restore();
    }
  });
});

test("private agent routes hit /v1 not /v1/public", async () => {
  await withEnv({
    PIPECAT_CLOUD_PRIVATE_KEY: "sk_test",
    PIPECAT_CLOUD_PUBLIC_KEY: "pk_test",
  }, async () => {
    const fetchMock = mockFetch((req) => {
      if (req.url.endsWith("/agents")) return jsonResponse(200, { agents: [] });
      return jsonResponse(200, { name: "zoco-voice", ready: true });
    });
    try {
      await listAgents({ region: "us-west" });
      await getAgent("zoco-voice");
      await stopSession("zoco-voice", "639f91d8-d511-4677-a83b-bd7564d5d92f");
      assert.equal(fetchMock.calls[0].url, "https://api.pipecat.daily.co/v1/agents?region=us-west");
      assert.equal(fetchMock.calls[0].headers.Authorization, "Bearer sk_test");
      assert.equal(fetchMock.calls[1].url, "https://api.pipecat.daily.co/v1/agents/zoco-voice");
      assert.equal(fetchMock.calls[2].method, "DELETE");
      assert.match(fetchMock.calls[2].url, /\/v1\/agents\/zoco-voice\/sessions\/639f91d8-d511-4677-a83b-bd7564d5d92f$/);
    } finally {
      fetchMock.restore();
    }
  });
});

test("session proxy uses the public API and preserves the bot path", async () => {
  await withEnv({
    PIPECAT_CLOUD_PUBLIC_KEY: "pk_test",
  }, async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { ok: true }));
    try {
      await sessionProxy("zoco-voice", "sid-9", "POST", "metrics/rtvi", { body: { ping: true } });
      assert.equal(
        fetchMock.calls[0].url,
        "https://api.pipecat.daily.co/v1/public/zoco-voice/sessions/sid-9/metrics/rtvi"
      );
      assert.equal(fetchMock.calls[0].method, "POST");
      assert.equal(JSON.parse(fetchMock.calls[0].body).ping, true);
    } finally {
      fetchMock.restore();
    }
  });
});

test("Cloud errors surface error and code from the API body", async () => {
  await withEnv({
    PIPECAT_CLOUD_PRIVATE_KEY: "sk_test",
  }, async () => {
    const fetchMock = mockFetch(() => jsonResponse(400, {
      error: "Service already exists",
      code: "GENERIC_BAD_REQUEST",
    }));
    try {
      await assert.rejects(
        () => upsertSecretSet("voice-secrets", { secrets: { DEEPGRAM_API_KEY: "x" } }),
        (error) => {
          assert.equal(error instanceof PipecatCloudError, true);
          assert.equal(error.message, "Service already exists");
          assert.equal(error.code, "GENERIC_BAD_REQUEST");
          assert.equal(error.status, 400);
          return true;
        }
      );
      assert.equal(fetchMock.calls[0].method, "PUT");
      assert.equal(fetchMock.calls[0].url, "https://api.pipecat.daily.co/v1/secrets/voice-secrets");
    } finally {
      fetchMock.restore();
    }
  });
});

test("Cloud client covers the public and private OpenAPI surface", async () => {
  await withEnv({
    PIPECAT_CLOUD_PUBLIC_KEY: "pk_test",
    PIPECAT_CLOUD_PRIVATE_KEY: "sk_test",
    PIPECAT_CLOUD_AGENT_NAME: "zoco-voice",
  }, async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { ok: true }));
    try {
      await createAgent({ serviceName: "zoco-voice", image: "zoco/voice:1" });
      await listAgents();
      await getAgent("zoco-voice");
      await updateAgent("zoco-voice", { image: "zoco/voice:2" });
      await getAgentLogs("zoco-voice", { limit: 10 });
      await listSessions("zoco-voice", { status: "active" });
      await getSession("zoco-voice", "sid-1");
      await stopSession("zoco-voice", "sid-1");
      await deleteAgent("zoco-voice");
      await listSecrets();
      await upsertSecretSet("zoco-secrets", { secrets: { DEEPGRAM_API_KEY: "x" } });
      await getSecretSet("zoco-secrets");
      await deleteSecret("zoco-secrets", "DEEPGRAM_API_KEY");
      await deleteSecretSet("zoco-secrets");
      await getUploadUrl({ fileName: "context.tar.gz" });
      await createBuild({ uploadId: "up-1" });
      await listBuilds();
      await getBuild("bld-1");
      await getBuildLogs("bld-1");
      await getProperties();
      await updateProperties({ defaultRegion: "us-west" });
      await getPropertiesSchema();
      await listRegions();
      await startSession("zoco-voice", { createDailyRoom: true });
      await sessionProxy("zoco-voice", "sid-1", "GET", "health");

      const lines = fetchMock.calls.map((call) => `${call.method} ${call.url}`);
      assert.deepEqual(lines, [
        "POST https://api.pipecat.daily.co/v1/agents",
        "GET https://api.pipecat.daily.co/v1/agents",
        "GET https://api.pipecat.daily.co/v1/agents/zoco-voice",
        "POST https://api.pipecat.daily.co/v1/agents/zoco-voice",
        "GET https://api.pipecat.daily.co/v1/agents/zoco-voice/logs?limit=10",
        "GET https://api.pipecat.daily.co/v1/agents/zoco-voice/sessions?status=active",
        "GET https://api.pipecat.daily.co/v1/agents/zoco-voice/sessions/sid-1",
        "DELETE https://api.pipecat.daily.co/v1/agents/zoco-voice/sessions/sid-1",
        "DELETE https://api.pipecat.daily.co/v1/agents/zoco-voice",
        "GET https://api.pipecat.daily.co/v1/secrets",
        "PUT https://api.pipecat.daily.co/v1/secrets/zoco-secrets",
        "GET https://api.pipecat.daily.co/v1/secrets/zoco-secrets",
        "DELETE https://api.pipecat.daily.co/v1/secrets/zoco-secrets/DEEPGRAM_API_KEY",
        "DELETE https://api.pipecat.daily.co/v1/secrets/zoco-secrets",
        "POST https://api.pipecat.daily.co/v1/builds/upload-url",
        "POST https://api.pipecat.daily.co/v1/builds",
        "GET https://api.pipecat.daily.co/v1/builds",
        "GET https://api.pipecat.daily.co/v1/builds/bld-1",
        "GET https://api.pipecat.daily.co/v1/builds/bld-1/logs",
        "GET https://api.pipecat.daily.co/v1/properties",
        "PUT https://api.pipecat.daily.co/v1/properties",
        "GET https://api.pipecat.daily.co/v1/properties/schema",
        "GET https://api.pipecat.daily.co/v1/regions",
        "POST https://api.pipecat.daily.co/v1/public/zoco-voice/start",
        "GET https://api.pipecat.daily.co/v1/public/zoco-voice/sessions/sid-1/health",
      ]);
    } finally {
      fetchMock.restore();
    }
  });
});

test("missing keys fail closed with 503", async () => {
  await withEnv({
    PIPECAT_CLOUD_PUBLIC_KEY: undefined,
    PIPECAT_PUBLIC_API_KEY: undefined,
    PIPECAT_API_KEY: undefined,
    PIPECAT_CLOUD_PRIVATE_KEY: undefined,
  }, async () => {
    await assert.rejects(
      () => cloudRequest({ auth: "public", method: "POST", path: "/x/start", body: {} }),
      (error) => error.status === 503 && error.code === "NOT_CONFIGURED"
    );
    await assert.rejects(
      () => listSecrets(),
      (error) => error.status === 503 && error.code === "NOT_CONFIGURED"
    );
  });
});
