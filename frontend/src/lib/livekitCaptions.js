/**
 * voice-caption-segment-map-v1
 * Accumulate LiveKit transcription segments by stable id so multi-segment
 * utterances stay complete on screen (interim replaces same id; new interim
 * clears prior finals for that role).
 */
export function createCaptionAccumulator() {
  const captions = new Map();

  function ingest(segments = [], role = "user") {
    for (const segment of segments || []) {
      const id = String(segment?.id || "").trim();
      if (!id) continue;
      const incoming = {
        text: String(segment?.text || "").trim(),
        final: segment?.final !== false,
        role,
      };
      if (!incoming.final) {
        for (const [existingId, item] of captions) {
          if (item.role === role && item.final) captions.delete(existingId);
        }
      }
      captions.set(id, incoming);
    }

    const parts = [...captions.values()].filter((item) => item.role === role && item.text);
    const text = parts.map((item) => item.text).join(" ").trim();
    const isFinal = parts.length > 0 && parts.every((item) => item.final);
    return { text, isFinal, parts: parts.length };
  }

  function clear(role) {
    if (!role) {
      captions.clear();
      return;
    }
    for (const [id, item] of captions) {
      if (item.role === role) captions.delete(id);
    }
  }

  return { ingest, clear };
}
