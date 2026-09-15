# Voice runtime

## Architecture (matches LiveKit quickstart)

```
Browser mic ──► LiveKit room ──► Agent worker (STT → LLM → TTS) ──► room audio
                     ▲
                     └── transcripts to studio UI
```

**Worker never manually toggles STT input** — that was causing stuck calls.

**Browser mic stays ON** while you speak so the last words of a slow sentence are not cut. If you talk over the agent, she should stop and listen. Use headphones on laptop speakers if echo appears.

## Run

```bash
npm run dev          # API + studio (port 8787 + 5173)
npm run dev:worker   # restart after every worker change
npm run test:voice
```

Hard refresh browser after frontend changes (Cmd+Shift+R).

See [VOICE_CHANGELOG.md](./VOICE_CHANGELOG.md) for tagged changes and how to revert them.

## Env

| Variable | Default | Notes |
| --- | --- | --- |
| `LIVEKIT_AGENT_NAME` | `zoco-voice` | Must match worker registration |
| `LIVEKIT_VOICE_BVC=0` | off | Disable server noise cancellation if speech clipped |

## Studio tips

- You can speak anytime — including while interrupting the agent.
- Use **headphones** on laptop speakers for cleanest audio.
- While you talk, the UI shows **…** only; the full line appears after you finish the sentence.
