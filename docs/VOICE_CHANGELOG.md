# Voice change log (revert tags)

Use these tags to revert a single change set if a release breaks studio voice.

| Tag | Date | What changed | Revert |
| --- | --- | --- | --- |
| `voice-ui-speaking-dots-v1` | 2026-09-10 | UI showed `…` whenever `heardIsFinal=false`, hiding Personalized partial text and showing dots before user spoke | Restore `ui.jsx` + `AgentStudio.jsx` `userSpeaking` state (this fix) |
| `voice-livekit-no-half-duplex-v1` | 2026-09-10 | Removed browser mic mute during agent TTS (barge-in fix) | Revert `frontend/src/lib/livekitVoice.js` half-duplex block |
| `voice-endpointing-900ms-v1` | 2026-09-10 | STT endpointing 900ms, dynamic 700–1500ms, preemptive LLM off | Revert `realtime/src/sessionTuning.js` constants |
| `voice-backchannel-resume-v1` | 2026-09-10 | `resumeFalseInterruption: true`, backchannel handling in worker | Revert `realtime/src/agent.ts` + `sessionTuning.js` |
| `voice-no-personalized-fallback-v1` | 2026-09-10 | LiveKit agents no longer silently fall back to Personalized | Revert `goLive()` in `AgentStudio.jsx` |
| `voice-whatsapp-consent-v1` | 2026-09-10 | `hasCallerIntent`, utterance coalesce, WhatsApp Yes fragments no longer swallowed | Revert `speechLanguage.js`, `agent.ts`, `sessionTuning.js` |
| `voice-caption-sticky-v1` | 2026-09-10 | User caption stays until saved in timeline; Hi/Yes not echo; greeting non-interruptible | Revert `ui.jsx`, `AgentStudio.jsx`, `speechLanguage.js`, `agent.ts` |
| `voice-phone-memory-v1` | 2026-09-10 | Phone digits + "this number/in memory" + hello hello no longer silent | Revert `speechLanguage.js`, `agent.ts` |
| `voice-listen-first-v1` | 2026-09-11 | Longer endpointing, half-duplex mic, single-word bleed ignored, coalesce repeat | Revert `sessionTuning.js`, `livekitVoice.js`, `agent.ts` |
| `voice-finish-utterance-v1` | 2026-09-11 | 1.8s endpointing, mic stays on, cut-off tails ignored, hello does not restart greeting | Revert `sessionTuning.js`, `livekitVoice.js`, `speechLanguage.js`, `agent.ts` |
| `voice-patient-listen-v1` | 2026-09-11 | 2.2s endpointing, slower TTS, do not rush/close, LiveKit complete-turn is listen-first | Revert `sessionTuning.js`, `agent.ts`, `conversation.js` |
| `voice-transcript-colon-gap-v1` | 2026-09-13 | Timeline shows `user: ` / `assistant: ` with space after the colon | Revert `frontend/src/components/ui.jsx` MessageTimeline labels |
| `voice-soft-close-thanks-v1` | 2026-09-13 | **REVERTED** — soft-close mutated LiveKit user messages + forced end_interaction; caused stuck speech and bad/missing user captions | Soft-close removed from LiveKit hot path; do not reintroduce via `setItemText` |
| `voice-live-partials-restore-v1` | 2026-09-13 | LiveKit interim user captions forward real text again (were blanked to `""` / ignored in studio) | Revert `livekitVoice.js` + `AgentStudio.jsx` interim `onTranscript` handling |
| `voice-caption-segment-map-v1` | 2026-09-13 | Restore segment-id caption map so multi-segment user lines stay complete on screen | Revert `livekitCaptions.js` + `livekitVoice.js` ingest |
| `voice-control-before-incomplete-v1` | 2026-09-13 | `stop` / `wait` / `goodbye` / `thank you` reply instead of silent `noise_repair` | Revert `isClearCallerClose` / barge-in order in `sessionTuning.js` |
| `voice-ignore-no-coalesce-v1` | 2026-09-13 | Ignored echo no longer coalesces into the next real user sentence | Revert ignore branch in `agent.ts` |
| `voice-conversation-script-v1` | 2026-09-13 | Offline multi-turn script simulator + tests (`turnSimulator.js`, `conversationScript.test.js`) | Delete those files if unused |
| `voice-hindi-open-tail-v1` | 2026-09-13 | Hindi/Telugu open endings (`का`/`की`/`के`/…) keep listening — fixes mid-pause reply on “कोई टेस्ट कंपनी का” | Revert `hasOpenLanguageTail` in `speechLanguage.js` |
| `voice-pause-endpointing-v1` | 2026-09-13 | **REVERTED** — 2.8s / 2.2–4.8s endpointing added ~600ms to perceived latency for little gain; cutoffs are handled by `hasOpenLanguageTail` instead. Back to 2.2s / 1.8–3.6s | Constants in `sessionTuning.js` |
| `voice-persist-partial-user-text-v1` | 2026-09-14 | Incomplete / noisy user speech is now persisted to the timeline instead of being dropped before `recordTranscript`. Only language-sync stays gated. Backend `transcriptRelation` merges `extend`/`join`, so fragments do not duplicate | Restore the early `return` in `ConversationItemAdded` in `agent.ts` |
| `voice-reply-ttfb-metric-v1` | 2026-09-14 | New `reply_ttfb_ms` telemetry: accepted user turn → agent `speaking`. This is the real perceived-lag number; `greeting_ms` only measures playout duration | Remove `replyClockStartedAt` + `AgentStateChanged` metric in `agent.ts` |
| `voice-greeting-language-v1` | 2026-09-14 | Greeting is translated into `call.language` before TTS. Agents authored a Telugu greeting but were dialled as `hi-IN`, so callers heard the wrong language from the first word and spent the call asking to switch | Revert `backend/src/engine/greeting.js`, `detectScriptLanguage` in `languages.js`, `buildSessionSnapshot` in `livekitSession.js` |
| `voice-stt-stay-multilingual-v1` | 2026-09-14 | STT stays in Deepgram `multi` for the whole call instead of being narrowed to one language. Narrowing deadlocked calls: pinned to Telugu, a Hindi caller transcribed as garble, so "please speak Hindi" could never be recognised | Restore the `stt.updateOptions` narrowing in `applySpeechLanguage` in `agent.ts` |
| `voice-language-switch-priority-v1` | 2026-09-14 | A language-switch request is always answered: routed to `reply` ahead of the incomplete/noise gates, applied even on `noise_repair` turns, and the model is told to apologise and re-ask in the new language. Audited callers waited 8–22s in silence | Revert `decideUserTurn` ordering in `sessionTuning.js` + switch branch in `agent.ts` |
| `voice-language-switch-negation-v1` | 2026-09-14 | "talk in English because I don't understand Hindi" no longer switches to the *rejected* language. Language names are matched by proximity and direction to the negation (English after the verb, Hindi/Telugu before) | Revert `rejectedLanguages` / `namesNear` in `speechLanguage.js` |
| `voice-greeting-playout-watchdog-v1` | 2026-09-14 | Greeting playout wait is bounded by `greetingPlayoutBudgetMs`. A hung `waitForPlayout()` left `greetingActive=true` forever, so the caller was ignored — one audited call had ~50s of dead air while the caller talked. Emits `greeting_playout_timeout_ms` | Restore the bare `await handle.waitForPlayout()` in `agent.ts` |
| `voice-record-agent-leg-v1` | 2026-09-14 | LiveKit calls are recorded at all (they previously never started the recorder), and the agent's LiveKit track is routed into the recording graph instead of surviving only as speaker bleed. 17/49 audited recordings had no usable agent audio | Revert `captureAgentTrack` in `livekitVoice.js` + `startMic`/`stopMic` calls in `goLiveLiveKit` |
| `voice-recording-integrity-v1` | 2026-09-14 | Each `MediaRecorder` owns its own chunk array and `startMic` stops any prior recorder first. Overlapping recorders wrote into one shared buffer, so uploads began mid-stream with no EBML header — 11/68 were undecodable by ffmpeg | Revert the `recorder.current` guard + `mediaChunks` in `AgentStudio.jsx` |
| `voice-no-prompt-in-transcript-v1` | 2026-09-14 | Steering text injected into the canonical user message is mapped back to the caller's real words before saving. A studio transcript had a whole user turn reading `The caller said "Hello?" only to check you are still on the line. Do not greet...` — the model prompt was being stored as caller speech | Revert `steerModel` + `steeredText` lookup in `agent.ts` |
| `voice-closing-tail-v1` | 2026-09-14 | `hasClosingTail` — "Yeah. Yeah. Okay, Thank you." ends in "you", so the open-tail rule read it as a half sentence, dropped the turn, and the caller got "I didn't catch that completely" instead of a goodbye. `isClearCallerClose` only matched a bare "thank you" | Revert `hasClosingTail` in `speechLanguage.js` |
| `voice-no-stale-repeat-prompt-v1` | 2026-09-14 | The coalesce repeat prompt is cancelled if any real turn was accepted after it was scheduled. `agentBusy` alone let it fire in the gap before a pending reply, producing "I didn't catch that completely" immediately followed by the correct answer | Revert `scheduledForTurn` guard in `agent.ts` |
| `voice-snappier-endpointing-v1` | 2026-09-14 | Endpointing 2.2s → 1.5s, dynamic 1.8–3.6s → 1.2–3.0s. Measured `reply_ttfb_ms` on a real call averaged 483ms, so this wait — not generation — was nearly all the dead air. Cutoffs stay protected by `noise_repair` coalescing, not by this timer | Constants in `sessionTuning.js` + assertions in `sessionTuning.test.js` |
| `voice-short-greeting-v1` | 2026-09-14 | Showcase greetings cut to one sentence (25→18, 35→19, 24→17 words); a measured `greeting_ms` of 9.2s delayed the caller's first chance to speak. Apply to existing agents with `node scripts/updateShowcaseGreetings.js` (greeting-only; `seedShowcaseAgents.js` also resets status/tests) | Revert greetings in `frontend/src/lib/showcasePacks.js` and re-run the update script |
| `voice-preemptive-generation-v1` | 2026-09-14 | Preemptive LLM generation enabled (the SDK default; we had opted out). Cuts a full LLM time-to-first-token off every clean turn. Safe by construction: the SDK cancels the preemptive speech handle whenever the final transcript, chat ctx, or tools differ, so `setItemText` / `StopResponse` turns fall back to normal generation. `preemptiveTts` stays off | Set `preemptiveGeneration.enabled` back to `false` in `sessionTuning.js` |

## Quick revert (git)

```bash
# Example: undo only the UI dots fix
git diff HEAD -- frontend/src/components/ui.jsx frontend/src/pages/AgentStudio.jsx

# Example: restore half-duplex mic (echo trade-off)
git log -1 --oneline -- frontend/src/lib/livekitVoice.js
```

## Before testing voice

1. Agent **Settings → Voice stack = LiveKit** (not Personalized).
2. `npm run dev` (API + studio)
3. `npm run dev:worker` (required for LiveKit)
4. Hard refresh browser (Cmd+Shift+R)

Badge must say **LiveKit**, not Personalized.
