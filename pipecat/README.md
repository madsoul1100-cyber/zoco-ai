# Pipecat voice worker

Zoco stores agents, campaigns, transcripts, and outcomes. [Pipecat Cloud](https://docs.pipecat.ai/api-reference/pipecat-cloud/rest-reference/overview) runs the hosted voice path:

`mic → Daily room → Deepgram STT → studio LLM → Cartesia TTS → speaker`

Zoco talks to Daily’s REST API the same way it talks to LiveKit Cloud:

| Auth | Base | Used for |
| --- | --- | --- |
| Public API key (`pk_…`) | `https://api.pipecat.daily.co/v1/public` | `POST /{agent}/start`, session proxy |
| Private API key | `https://api.pipecat.daily.co/v1` | agents, secrets, builds, regions, org properties |

## Cloud (recommended)

Keys in the repo-root `.env`:

```bash
PIPECAT_CLOUD_PUBLIC_KEY=pk_...
PIPECAT_CLOUD_PRIVATE_KEY=...
PIPECAT_CLOUD_AGENT_NAME=zoco-voice
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
ZOCO_BRIDGE_URL=https://your-zoco-host
```

Deploy this `pipecat/` image to Pipecat Cloud (or point `PIPECAT_CLOUD_AGENT_NAME` at an agent already deployed there). Studio **Test agent** calls `POST /v1/public/{agent}/start` with `createDailyRoom: true` and joins the returned Daily room.

Put `ZOCO_BRIDGE_URL`, `PIPECAT_BRIDGE_TOKEN` (or `LIVEKIT_BRIDGE_TOKEN`), `DEEPGRAM_API_KEY`, and `CARTESIA_API_KEY` in the Cloud secret set bound to the agent.

Zoco also exposes the Cloud REST surface under `/api/pipecat/cloud/...` (agents, sessions, secrets, builds, regions, properties, session proxy).

## Run locally

```bash
PIPECAT_ENABLED=true
PIPECAT_URL=http://127.0.0.1:7860
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
```

The worker reuses `LIVEKIT_BRIDGE_TOKEN` (or `PIPECAT_BRIDGE_TOKEN`) to talk to the Zoco API. The LLM key comes from the agent snapshot (OpenRouter / OpenAI).

```bash
npm run dev:pipecat
```

That uses `uv` if it is installed, otherwise a local `pipecat/.venv`. First run may take a minute while Python packages install.

Keep `npm run dev` running for the API and studio. In Agent Studio, set **Voice stack** to **Pipecat**, then click **Test agent**.

Phone calls use Daily PSTN (Cloud start with `enable_dialout`, or local `DAILY_API_KEY`). Otherwise outbound still falls back to Exotel.
