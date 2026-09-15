import test from "node:test";
import assert from "node:assert/strict";
import {
  isExotelStreamMetadataRequest,
} from "../src/telephony/exotelInbound.js";
import {
  exotelInboundStreamResolverUrl,
  exotelPassthruUrl,
} from "../src/telephony/exotel.js";

test("isExotelStreamMetadataRequest detects passthru stream fields", () => {
  assert.equal(isExotelStreamMetadataRequest({ From: "+919800000000" }), false);
  assert.equal(isExotelStreamMetadataRequest({ "Stream[Status]": "completed" }), true);
  assert.equal(isExotelStreamMetadataRequest({ StreamSid: "abc" }), true);
});

test("exotel inbound dashboard URLs are built from public base", () => {
  const tel = { publicBaseUrl: "https://voice.example.com" };
  assert.equal(
    exotelInboundStreamResolverUrl(tel),
    "https://voice.example.com/webhooks/exotel/inbound"
  );
  assert.equal(
    exotelPassthruUrl(tel),
    "https://voice.example.com/webhooks/exotel/passthru"
  );
});
