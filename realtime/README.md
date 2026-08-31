# LiveKit Priya Outbound Pilot

Feature-flagged realtime phone path for the Priya MLC agent. Zoco remains the control plane; LiveKit Cloud handles media; the worker delegates conversation logic back to Zoco over an authenticated bridge.

## Enable the pilot

1. Copy LiveKit and bridge settings into `.env` from `.env.example`.
2. Configure a Twilio SIP trunk and LiveKit outbound trunk (`LIVEKIT_SIP_OUTBOUND_TRUNK_ID`).
3. Deploy the worker to LiveKit Cloud (agent name must match `LIVEKIT_AGENT_NAME`, default `zoco-priya-pilot`).
4. Set:

```bash
LIVEKIT_PILOT_ENABLED=true
LIVEKIT_PILOT_AGENT_ID=agt_priya_mlc_outbound
LIVEKIT_BRIDGE_TOKEN=<shared-secret>
```

5. Start services:

```bash
npm run install:all
npm run dev:all
```

Only calls for the configured Priya agent use LiveKit when `livekitReady()` is true. All other agents and failed LiveKit dispatches continue on the existing Twilio TwiML path.

## A/B comparison checklist

Run the same scripted English/Hindi/Telugu cases on both paths and record:

- Median and p95 user-stop → first agent audio
- Barge-in correctness
- Language switch accuracy
- Outcome/disposition completion
- Disconnect and failure rate
- Per-call provider cost

Rollback is `LIVEKIT_PILOT_ENABLED=false`.
