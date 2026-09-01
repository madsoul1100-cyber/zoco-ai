import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";

function playBotTrack(track, participant, attached) {
  if (!track || track.kind !== "audio") return;
  if (participant?.local) return;
  const el = document.createElement("audio");
  el.autoplay = true;
  el.playsInline = true;
  el.srcObject = new MediaStream([track]);
  el.style.display = "none";
  document.body.appendChild(el);
  void el.play?.().catch(() => {});
  attached.push(el);
}

export async function connectPipecatVoice({
  startUrl,
  dailyRoom,
  dailyToken,
  iceConfig,
  transport = "webrtc",
  callId,
  agentId,
  enableDefaultIceServers = true,
  onTranscript,
  onSpeaking,
  onDisconnected,
  onAgentJoined,
} = {}) {
  const useDaily = Boolean(dailyRoom && dailyToken) || transport === "daily";
  let TransportClass = SmallWebRTCTransport;
  if (useDaily) {
    const mod = await import("@pipecat-ai/daily-transport");
    TransportClass = mod.DailyTransport;
  }

  const attached = [];
  const iceServers = iceConfig?.iceServers
    || (useDaily ? undefined : [{ urls: "stun:stun.l.google.com:19302" }]);
  const client = new PipecatClient({
    transport: new TransportClass(iceServers ? { iceServers } : undefined),
    enableMic: true,
    enableCam: false,
    callbacks: {
      onBotReady: () => onAgentJoined?.(),
      onDisconnected: () => onDisconnected?.(),
      onBotDisconnected: () => onDisconnected?.(),
      onTrackStarted: (track, participant) => playBotTrack(track, participant, attached),
      onBotStartedSpeaking: () => onSpeaking?.(true),
      onBotStoppedSpeaking: () => onSpeaking?.(false),
      onUserTranscript: (data) => {
        const text = String(data?.text || "").trim();
        if (!text) return;
        onTranscript?.({ text, isFinal: data?.final !== false, role: "user" });
      },
      onBotTranscript: (data) => {
        const text = String(data?.text || "").trim();
        if (!text) return;
        onTranscript?.({ text, isFinal: true, role: "assistant" });
      },
      onBotOutput: (data) => {
        const text = String(data?.text || data?.accumulated_text || "").trim();
        if (!text) return;
        onTranscript?.({ text, isFinal: Boolean(data?.spoken), role: "assistant" });
      },
    },
  });

  if (dailyRoom && dailyToken) {
    await client.connect({ url: dailyRoom, token: dailyToken });
  } else if (startUrl) {
    await client.startBotAndConnect({
      endpoint: startUrl,
      requestData: {
        transport,
        enableDefaultIceServers,
        body: { callId, agentId, channel: "web" },
      },
    });
  } else {
    throw new Error("Pipecat session is missing a Daily room or local start URL.");
  }

  return {
    client,
    callId,
    sessionId: "",
    async disconnect() {
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
      for (const el of attached) {
        try {
          el.pause?.();
          el.srcObject = null;
          el.remove();
        } catch {
          /* ignore */
        }
      }
      attached.length = 0;
    },
  };
}
