# Zoco AI

Self-hosted **voice calling platform**. Zoco lets a team create an AI agent, talk to it over chat or browser voice, store every turn as JSON, keep the recording, and decide what happens next: **successful**, **still in progress**, or **recall the customer**.

This is a working prototype. Real telephony, visual workflow graphs, and production STT/TTS land feature by feature after this slice.

## Run the prototype

```bash
cd zoco-ai
npm run install:all
npm run dev
```

- App: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:8787](http://localhost:8787)

Optional LLM: set `OPENAI_API_KEY` before `npm run dev`. Without it, Zoco uses a local conversation engine so the prototype still works.

## What this prototype already does

- Create inbound / outbound agents with greeting, persona, and success criteria
- **Test chat** and **test voice** (browser mic + speech synthesis)
- Save each call as `data/calls/{id}.json` with a **message-wise transcript**
- Attach a browser recording to the same call
- Outcome rules: success, no answer, busy, dropped mid-call, voicemail, callback requested
- Recall queue with attempt limits and delays
- Dashboard of live calls, success, and due recalls

## Features we will give users (product)

| Area | What the user gets |
| --- | --- |
| **Agent studio** | Describe a use case, set direction (inbound/outbound), edit greeting and success rules, test in minutes |
| **AI calling** | Outbound dials and inbound answering, with the same agent logic on phone, web voice, and chat |
| **Live conversation** | Transcript as the call happens, with agent + customer turns |
| **Call record** | Recording + JSON transcript + gathered fields (name, intent, callback time) |
| **Outcomes** | Explicit statuses: ringing, in progress, completed, no answer, busy, voicemail, dropped, failed |
| **Recall rules** | Auto-queue another attempt when the call did not finish the job |
| **Campaigns** | Upload a list, dial with concurrency, business hours, and retries |
| **Tools** | End call, transfer to a human, HTTP APIs, knowledge base |
| **Bring your own keys** | LLM, STT, TTS, and telephony providers on your infra |
| **Webhooks / API** | Trigger a call from a CRM; send the result back when it ends |

Those match the core of an open-source Vapi-style platform (workflow agents, runs, recordings, campaigns, telephony). Zoco ships them under **our** product name and UX, not a reskin of another brand.

## Call JSON (message-wise)

Every conversation is one file, for example `data/calls/call_success_01.json`:

```json
{
  "id": "call_success_01",
  "status": "completed",
  "disposition": "qualified",
  "customer": { "name": "Riya Shah", "phone": "+919876543210" },
  "messages": [
    { "id": "msg_1", "role": "assistant", "text": "Hi, this is Maya from Zoco…", "timestamp": "…" },
    { "id": "msg_2", "role": "user", "text": "Yes, I filled the form this morning.", "timestamp": "…" }
  ],
  "recordingUrl": "/api/calls/call_success_01/recording",
  "recall": { "needed": false }
}
```

## Outcome rules (prototype defaults)

| End state | Meaning | Next action |
| --- | --- | --- |
| `success` / `qualified` / `booked` | Goal met | Store and stop |
| `in_progress` | Line is live | Keep transcribing |
| `no_answer` | Rang out | Recall in 60 min |
| `busy` | Line busy | Recall in 15 min |
| `dropped` | Hung up mid-call | Recall in 5 min |
| `voicemail` | Machine | Recall next day |
| `callback_requested` | Customer asked | Recall in 2 hours |
| `do_not_call` | Opted out | Never recall |

Max attempts default to 3. Edit them in **Call rules**.

## Enable next (in order)

1. **Real STT/TTS** — Deepgram / Whisper + a TTS voice, not only the browser
2. **Twilio / Plivo outbound** — one PSTN call from the studio
3. **Visual workflow graph** — start → qualify → end, with conditions
4. **Campaign CSV dialer** — list + concurrency + the recall rules above
5. **Post-call QA** — score the JSON transcript against the success criteria
6. **Website widget** — same agent on a site, chat or voice
7. **Human handoff** — transfer when the agent is stuck

## How we make Zoco more visible than a generic clone

This is where we should not copy another product’s homepage. Zoco should own a sharper story:

1. **Outcome-first, not prompt-first** — the first screen is success / live / recall, not a blank workflow canvas.
2. **The call file is the product** — one JSON + one audio file per call, exportable, replayable from any turn. Easy to sell to ops and compliance teams.
3. **Recall as a first-class product** — most voice stacks hide retries inside campaigns. We put “call them back” on the dashboard.
4. **India-ready voice** — `en-IN` by default, later Hindi/English code-switch, TRAI/DND windows, Exotel/Knowlarity/Plivo.
5. **WhatsApp after a failed dial** — if the voice attempt misses, send the same agent turn over chat. That loop is visible and useful.
6. **Audio synced to messages** — click a transcript line, hear that second of the recording.
7. **BPO / white-label** — agencies run Zoco under their own name; we never ship another company’s branding.

## Architecture (now vs later)

```
Browser studio  →  Zoco API  →  JSON files (calls, agents, rules)
                      ↓
                 Conversation engine (local or OpenAI)
                      ↓
                 Browser mic / TTS   → later: Twilio audio + STT/TTS providers
```

Later the JSON files move to Postgres, recordings to S3, and the engine to a realtime voice pipeline. The call document shape stays the same.

Inspired by the architecture of open-source voice-agent platforms (agents, runs, recordings, campaigns, recall). Implementation and branding are original to Zoco AI.
