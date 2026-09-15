import { ParticipantEvent, Room, RoomEvent, Track } from "livekit-client";
import { createCaptionAccumulator } from "./livekitCaptions.js";
import { isLikelyAgentEcho } from "./voice.js";

function isAgentParticipant(participant) {
  if (!participant) return false;
  if (participant.isAgent) return true;
  const identity = String(participant.identity || "").toLowerCase();
  const kind = String(participant.kind || "").toLowerCase();
  if (kind === "agent" || kind.includes("agent")) return true;
  if (identity.startsWith("agent") || identity.includes("agent") || identity.startsWith("ak_")) return true;
  return false;
}

/**
 * LiveKit browser client:
 * - Mic stays ON so the rest of a slow sentence is never cut
 * - If the caller talks over the agent, audio still reaches STT (barge-in)
 * - Captions accumulate by segment id so the full spoken line stays visible
 */
export async function connectLiveKitVoice({
  url,
  token,
  onTranscript,
  onSpeaking,
  onDisconnected,
  onAgentJoined,
  captureContext,
  captureDestination,
} = {}) {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  let agentAudioStarted = false;
  let resolveAgentAudio;
  let agentSpeakerActive = false;
  let agentVadActive = false;
  let lastAssistantText = "";
  let agentParticipant = null;
  // voice-caption-segment-map-v1
  const userCaptions = createCaptionAccumulator();
  const assistantCaptions = createCaptionAccumulator();

  function agentAudioActive() {
    return agentSpeakerActive || agentVadActive;
  }

  function notifyAgentSpeaking() {
    onSpeaking?.(agentAudioActive());
  }

  function noteAgentAudio() {
    if (agentAudioStarted) return;
    agentAudioStarted = true;
    resolveAgentAudio?.();
  }

  /*
   * voice-record-agent-leg-v1
   *
   * Route the agent's audio into the call recorder as well as the speakers.
   *
   * Previously only the microphone reached the recorder, so the agent survived in
   * recordings solely as acoustic bleed from the laptop speakers — quiet, echoed, and
   * absent entirely on headphones. A call audit found 17 of 49 recordings with no usable
   * agent audio, which made them useless for judging call quality.
   */
  const captureSources = new Set();

  function captureAgentTrack(track) {
    if (!captureContext || !captureDestination) return;
    const mediaStreamTrack = track?.mediaStreamTrack;
    if (!mediaStreamTrack) return;
    try {
      const source = captureContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
      source.connect(captureDestination);
      captureSources.add(source);
    } catch {
      /* recording the agent leg is best-effort; never block playback */
    }
  }

  function releaseCaptureSources() {
    for (const source of captureSources) {
      try {
        source.disconnect();
      } catch {
        /* already torn down */
      }
    }
    captureSources.clear();
  }

  function watchAgent(participant) {
    if (!isAgentParticipant(participant) || agentParticipant === participant) return;
    agentParticipant = participant;
    onAgentJoined?.(participant);
    participant.on(ParticipantEvent.IsSpeakingChanged, (speaking) => {
      agentVadActive = Boolean(speaking);
      notifyAgentSpeaking();
    });
  }

  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track?.kind !== Track.Kind.Audio || !participant || participant === room.localParticipant) return;
    noteAgentAudio();
    track.attach().play?.().catch(() => {});
    captureAgentTrack(track);
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    agentSpeakerActive = speakers.some((speaker) => isAgentParticipant(speaker));
    notifyAgentSpeaking();
  });

  room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
    const role = isAgentParticipant(participant) ? "assistant" : "user";
    const bucket = role === "assistant" ? assistantCaptions : userCaptions;
    const { text, isFinal } = bucket.ingest(segments, role);
    if (!text) return;

    if (role === "assistant") {
      lastAssistantText = text;
      onTranscript?.({ text, isFinal, role });
      return;
    }

    if (isLikelyAgentEcho(text, lastAssistantText)) return;
    onTranscript?.({ text, isFinal, role, speaking: !isFinal });
  });

  room.on(RoomEvent.Disconnected, () => {
    onDisconnected?.();
  });

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    watchAgent(participant);
  });

  await room.connect(url, token);
  await room.startAudio().catch(() => {});
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch {
    /* ignore */
  }

  for (const participant of room.remoteParticipants.values()) {
    watchAgent(participant);
    participant.audioTrackPublications?.forEach?.((publication) => {
      if (publication.track?.kind === Track.Kind.Audio) {
        noteAgentAudio();
        publication.track.attach().play?.().catch(() => {});
        captureAgentTrack(publication.track);
      }
    });
  }

  await new Promise((resolve, reject) => {
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
      watchAgent(participant);
      resolve();
    }
    room.on(RoomEvent.ParticipantConnected, onJoin);
  });

  if (!agentAudioStarted) {
    await Promise.race([
      new Promise((resolve) => {
        resolveAgentAudio = resolve;
        if (agentAudioStarted) resolve();
      }),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  }

  return {
    room,
    async disconnect() {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* ignore */
      }
      releaseCaptureSources();
      await room.disconnect();
    },
  };
}
