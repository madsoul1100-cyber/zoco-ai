import { ParticipantEvent, Room, RoomEvent, Track } from "livekit-client";

function isAgentParticipant(participant) {
  if (!participant) return false;
  if (participant.isAgent) return true;
  const identity = String(participant.identity || "").toLowerCase();
  const kind = String(participant.kind || "").toLowerCase();
  if (kind === "agent" || kind.includes("agent")) return true;
  if (identity.startsWith("agent") || identity.includes("agent") || identity.startsWith("ak_")) return true;
  return false;
}

export async function connectLiveKitVoice({
  url,
  token,
  onTranscript,
  onSpeaking,
  onDisconnected,
  onAgentJoined,
} = {}) {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    webAudioMix: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      voiceIsolation: true,
    },
  });

  const attached = new Set();
  const agentTracks = [];
  const captions = new Map();
  let agentAudioStarted = false;
  let resolveAgentAudio;
  let userSpeaking = false;
  let agentSpeaking = false;

  function noteAgentAudio() {
    if (agentAudioStarted) return;
    agentAudioStarted = true;
    resolveAgentAudio?.();
  }

  function setAgentPlayback(on) {
    for (const track of agentTracks) {
      try {
        track.setVolume?.(on ? 1 : 0);
      } catch {
        /* ignore */
      }
    }
  }

  function syncPlayback() {
    onSpeaking?.(agentSpeaking);
    setAgentPlayback(!(userSpeaking && agentSpeaking));
  }

  function attachTrack(track, participant) {
    if (!track || track.kind !== Track.Kind.Audio || attached.has(track.sid)) return;
    const el = track.attach();
    el.autoplay = true;
    el.playsInline = true;
    el.style.display = "none";
    document.body.appendChild(el);
    attached.add(track.sid);
    if (typeof track.setVolume === "function") agentTracks.push(track);
    void el.play?.().catch(() => {});
    if (participant && participant !== room.localParticipant) {
      noteAgentAudio();
      agentSpeaking = true;
      syncPlayback();
    }
  }

  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    attachTrack(track, participant);
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    agentSpeaking = speakers.some((speaker) => isAgentParticipant(speaker) || speaker !== room.localParticipant);
    userSpeaking = speakers.some((speaker) => speaker === room.localParticipant);
    syncPlayback();
  });

  room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
    const role = isAgentParticipant(participant) ? "assistant" : "user";
    for (const segment of segments || []) {
      if (!segment?.id) continue;
      const incoming = {
        text: String(segment.text || "").trim(),
        final: segment.final !== false,
        role,
      };
      if (!incoming.final) {
        for (const [id, item] of captions) {
          if (item.role === role && item.final) captions.delete(id);
        }
      }
      captions.set(segment.id, incoming);
    }
    const parts = [...captions.values()].filter((item) => item.role === role && item.text);
    const text = parts.map((item) => item.text).join(" ").trim();
    if (!text) return;
    const isFinal = parts.length > 0 && parts.every((item) => item.final);
    onTranscript?.({ text, isFinal, role });
  });

  room.on(RoomEvent.Disconnected, () => {
    onDisconnected?.();
  });

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    if (isAgentParticipant(participant)) onAgentJoined?.(participant);
  });

  await room.connect(url, token);
  await room.startAudio().catch(() => {});

  room.localParticipant.on(ParticipantEvent.IsSpeakingChanged, (speaking) => {
    userSpeaking = Boolean(speaking);
    syncPlayback();
  });

  for (const participant of room.remoteParticipants.values()) {
    if (isAgentParticipant(participant)) onAgentJoined?.(participant);
    participant.audioTrackPublications?.forEach?.((publication) => {
      if (publication.track) attachTrack(publication.track, participant);
    });
  }

  const waitForAgent = new Promise((resolve, reject) => {
    const existing = [...room.remoteParticipants.values()].filter((p) => p !== room.localParticipant);
    if (existing.length) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      reject(
        new Error(
          "LiveKit worker did not join the room. From the repo root run `npm run dev:worker` (keep the API and studio running)."
        )
      );
    }, 30000);
    function onJoin(participant) {
      if (participant === room.localParticipant) return;
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      onAgentJoined?.(participant);
      resolve();
    }
    room.on(RoomEvent.ParticipantConnected, onJoin);
  });

  await waitForAgent;

  if (!agentAudioStarted) {
    await Promise.race([
      new Promise((resolve) => {
        resolveAgentAudio = resolve;
        if (agentAudioStarted) resolve();
      }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  }

  await room.localParticipant.setMicrophoneEnabled(true);

  return {
    room,
    async disconnect() {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* ignore */
      }
      await room.disconnect();
      attached.clear();
      agentTracks.length = 0;
    },
  };
}
