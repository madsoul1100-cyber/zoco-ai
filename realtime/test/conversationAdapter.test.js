import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function eventId(prefix) {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

test("eventId generates unique prefixed ids", () => {
  const a = eventId("turn");
  const b = eventId("turn");
  assert.match(a, /^turn_/);
  assert.notEqual(a, b);
});
