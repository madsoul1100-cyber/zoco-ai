/**
 * Browser mic → PCM 16kHz mono → backend /api/stt/stream (Sarvam realtime).
 */

function downsampleTo16k(float32, inputRate) {
  const target = 16000;
  if (!float32?.length) return new Int16Array(0);
  if (inputRate === target) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i += 1) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inputRate / target;
  const newLen = Math.floor(float32.length / ratio);
  const out = new Int16Array(newLen);
  for (let i = 0; i < newLen; i += 1) {
    const idx = Math.min(float32.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, float32[idx]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function wsUrl(language, eagerness) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({
    language: language || "auto",
    eagerness: String(eagerness ?? 7),
  });
  return `${proto}//${window.location.host}/api/stt/stream?${params}`;
}

/**
 * @param {object} opts
 * @param {(text: string, meta?: { language?: string|null }) => void} opts.onPartial
 * @param {(text: string, meta?: { language?: string|null }) => void} opts.onFinal
 * @param {(err: string) => void} [opts.onError]
 * @param {() => void} [opts.onReady]
 * @param {() => boolean} [opts.shouldSend] return false to mute uplink (still keep socket)
 */
export async function startStreamingStt({
  language = "auto",
  eagerness = 7,
  onPartial,
  onFinal,
  onError,
  onReady,
  onVadStart,
  onVadEnd,
  onClose,
  shouldSend,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone is not available in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch {
      /* ignore */
    }
  }
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  let socket = null;
  let closed = false;
  let pending = [];

  const flushPending = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    while (pending.length) {
      socket.send(pending.shift());
    }
  };

  const sendAudio = (base64) => {
    if (closed) return;
    if (shouldSend && !shouldSend()) return;
    const payload = JSON.stringify({ type: "audio", audio: base64 });
    if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
    else pending.push(payload);
  };

  processor.onaudioprocess = (event) => {
    if (closed) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm = downsampleTo16k(input, audioCtx.sampleRate);
    if (!pcm.length) return;
    sendAudio(int16ToBase64(pcm));
  };

  socket = new WebSocket(wsUrl(language, eagerness));
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    flushPending();
  };

  socket.onmessage = (event) => {
    let msg = null;
    try {
      msg = JSON.parse(String(event.data || ""));
    } catch {
      return;
    }
    if (msg.type === "ready") {
      onReady?.();
      return;
    }
    if (msg.type === "partial") {
      onPartial?.(String(msg.text || "").trim(), { language: msg.language || null });
      return;
    }
    if (msg.type === "final") {
      onFinal?.(String(msg.text || "").trim(), { language: msg.language || null });
      return;
    }
    if (msg.type === "vad_start") {
      onVadStart?.();
      return;
    }
    if (msg.type === "vad_end") {
      onVadEnd?.();
      return;
    }
    if (msg.type === "error") {
      onError?.(msg.error || "Live transcription failed");
    }
  };

  socket.onerror = () => {
    onError?.("Live transcription socket failed");
  };

  socket.onclose = () => {
    if (!closed) {
      closed = true;
      onClose?.();
    }
  };

  return {
    stop() {
      if (closed) return;
      closed = true;
      try {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "end" }));
        }
      } catch {
        /* ignore */
      }
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      try {
        processor.disconnect();
        source.disconnect();
        mute.disconnect();
      } catch {
        /* ignore */
      }
      try {
        audioCtx.close();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
