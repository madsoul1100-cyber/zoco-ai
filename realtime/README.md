# LiveKit voice worker

Zoco stores agents, campaigns, transcripts, and outcomes. LiveKit Cloud runs the full voice path:

`mic → LiveKit room → Deepgram STT → Gemma LLM → Cartesia TTS → speaker`

## Run locally

Keys in the repo-root `.env`:

```bash
LIVEKIT_ENABLED=true
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_AGENT_NAME=zoco-voice
```

```bash
npm run install:all
npm run dev
```

In Agent Studio, click **Test agent**. No Sarvam or OpenRouter keys are required for voice.

Phone calls use LiveKit SIP when `LIVEKIT_SIP_OUTBOUND_TRUNK_ID` is set. Otherwise outbound still falls back to Exotel.
