/**
 * voice-caption-segment-map-v1
 * Segment-id caption accumulation (why partial user lines disappeared).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCaptionAccumulator } from "../src/lib/livekitCaptions.js";

test("same segment id interim grows; final keeps full line", () => {
  const caps = createCaptionAccumulator();
  let out = caps.ingest([{ id: "a", text: "Yes you", final: false }], "user");
  assert.equal(out.text, "Yes you");
  assert.equal(out.isFinal, false);

  out = caps.ingest([{ id: "a", text: "Yes you can", final: false }], "user");
  assert.equal(out.text, "Yes you can");

  out = caps.ingest(
    [{ id: "a", text: "Yes you can send it on WhatsApp", final: true }],
    "user"
  );
  assert.equal(out.text, "Yes you can send it on WhatsApp");
  assert.equal(out.isFinal, true);
});

test("second segment appends instead of replacing the first final", () => {
  const caps = createCaptionAccumulator();
  caps.ingest([{ id: "a", text: "Yes, you can", final: true }], "user");
  const out = caps.ingest(
    [{ id: "b", text: "send it on WhatsApp", final: true }],
    "user"
  );
  assert.equal(out.text, "Yes, you can send it on WhatsApp");
  assert.equal(out.isFinal, true);
});

test("new interim clears prior finals so a new utterance starts clean", () => {
  const caps = createCaptionAccumulator();
  caps.ingest([{ id: "a", text: "Thank you", final: true }], "user");
  const out = caps.ingest([{ id: "b", text: "Hello", final: false }], "user");
  assert.equal(out.text, "Hello");
  assert.equal(out.isFinal, false);
});
