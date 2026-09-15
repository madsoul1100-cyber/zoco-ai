import test from "node:test";
import assert from "node:assert/strict";
import { isExplicitHangupRequest, parseEndTag, stripEndTag } from "../src/hangup.js";
import { decideUserTurn } from "../src/sessionTuning.js";

test("parseEndTag strips spoken end markers and yields disposition", () => {
  const parsed = parseEndTag("ठीक है, धन्यवाद। [END:success]");
  assert.equal(parsed.endCall, true);
  assert.equal(parsed.disposition, "success");
  assert.equal(parsed.text, "ठीक है, धन्यवाद।");
  assert.equal(stripEndTag("Okay. [END:not_interested]"), "Okay.");
});

test("explicit hangup requests are detected across en/hi", () => {
  assert.equal(isExplicitHangupRequest("Okay. Call खत्म हो गई है तो काट दो आप."), true);
  assert.equal(isExplicitHangupRequest("please hang up"), true);
  assert.equal(isExplicitHangupRequest("end the call"), true);
  assert.equal(isExplicitHangupRequest("I have a minute"), false);
  assert.equal(
    decideUserTurn("काट दो आप", {
      ttsLanguage: "hi",
      lastSpoken: "धन्यवाद",
    }),
    "reply"
  );
});
