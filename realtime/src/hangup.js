/**
 * LiveKit hangup helpers — the model often emits chat-style [END:disposition]
 * instead of calling end_interaction. Parse/strip those tags and detect explicit
 * "please hang up" requests so the room actually closes.
 */

const END_RE = /\[END:([a-z_]+)\]/gi;

export function parseEndTag(text = "") {
  const raw = String(text || "");
  const match = raw.match(/\[END:([a-z_]+)\]/i);
  const clean = raw.replace(END_RE, "").replace(/\s+/g, " ").trim();
  return {
    text: clean,
    endCall: Boolean(match),
    disposition: match?.[1]?.toLowerCase() || null,
  };
}

export function stripEndTag(text = "") {
  return parseEndTag(text).text;
}

/** Caller clearly asking to cut/end the call now. */
export function isExplicitHangupRequest(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const lower = raw
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!lower) return false;
  if (
    /\b(hang up|end (the )?call|cut (the )?call|disconnect|please (end|cut|hang)|you can hang|you can cut)\b/.test(
      lower
    )
  ) {
    return true;
  }
  if (/काट\s*दो|काट\s*दीजिए|कॉल\s*काट|खत्म\s*कर|कॉल\s*खत्म|बंद\s*कर\s*दो/.test(raw)) return true;
  if (/కాల్\s*కట్|ముగించండి|పెట్టేయండి/.test(raw)) return true;
  if (/call\s*(ख़त्म|खत्म|khatam)|khatam\s*kar/.test(lower)) return true;
  return false;
}
