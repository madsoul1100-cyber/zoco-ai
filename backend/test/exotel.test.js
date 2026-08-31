import test from "node:test";
import assert from "node:assert/strict";
import {
  exotelStreamUrl,
  mapExotelStatus,
} from "../src/telephony/exotel.js";

test("mapExotelStatus handles Exotel terminal states", () => {
  assert.equal(mapExotelStatus("completed").status, "completed");
  assert.equal(mapExotelStatus("no-answer").status, "no_answer");
  assert.equal(mapExotelStatus("busy").status, "busy");
});

test("exotelStreamUrl builds wss stream endpoint", async () => {
  const tel = {
    publicBaseUrl: "https://voice.example.com",
  };
  const url = exotelStreamUrl(tel, "call_abc123", 16000);
  assert.match(url, /^wss:\/\/voice\.example\.com\/api\/exotel\/stream\?callId=call_abc123/);
  assert.match(url, /sample-rate=16000/);
});

test("exotelStreamUrl uses wss for https public URL", () => {
  const url = exotelStreamUrl(
    { publicBaseUrl: "https://voice.example.com" },
    "call_abc",
    16000
  );
  assert.match(url, /^wss:\/\/voice\.example\.com\/api\/exotel\/stream\?callId=call_abc/);
});
