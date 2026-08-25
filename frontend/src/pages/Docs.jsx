import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui.jsx";

const toc = [
  ["start", "Start here"],
  ["agent", "Build an agent"],
  ["knowledge", "Knowledge base"],
  ["workflow", "Workflow"],
  ["test", "Test in studio"],
  ["numbers", "Phone numbers"],
  ["inbound", "Inbound calls"],
  ["outbound", "Outbound campaigns"],
  ["monitor", "Monitor"],
  ["code", "Deploy with code"],
];

export default function Docs() {
  return (
    <>
      <PageHeader
        title="How to use Zoco"
        subtitle="Create a voice agent, ground it in your files, put a number on it, then watch every live call as a transcript plus outcome."
      />

      <nav className="docs-toc" aria-label="On this page">
        {toc.map(([id, label]) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </nav>

      <article className="docs-body">
        <section id="start" className="docs-section">
          <h3>Start here</h3>
          <p>
            Zoco is a voice-agent desk. You write how the agent should talk, attach documents it is allowed to use,
            then either answer a phone number or dial a list. Every call is stored as JSON: customer, language, transcript, recording, outcome.
          </p>
          <ol className="steps">
            <li><b>Build</b> an agent on <Link to="/agents">Agents</Link>.</li>
            <li><b>Ground</b> it with a <Link to="/knowledge">knowledge base</Link> if it must not invent facts.</li>
            <li><b>Test</b> in studio chat or browser voice.</li>
            <li><b>Deploy</b> inbound on a Twilio number, or launch an outbound campaign.</li>
            <li><b>Monitor</b> <Link to="/calls">call logs</Link>, <Link to="/boards">boards</Link>, and <Link to="/analytics">analytics</Link>.</li>
          </ol>
        </section>

        <section id="agent" className="docs-section">
          <h3>Build an agent</h3>
          <p>
            On <Link to="/agents">Agents</Link>, describe the job in the prompt bar, start from a template, or create from scratch.
            That opens the studio.
          </p>
          <ul>
            <li><b>Instructions</b> — greeting first, then named sections. You can paste a full prompt and split it into sections.</li>
            <li><b>Variables</b> — input values the agent can speak (<code>{"{{customer_name}}"}</code>) and output fields extracted after the call.</li>
            <li><b>Tools</b> — built-in End Interaction and Query Knowledge Base, plus custom tools you describe.</li>
            <li><b>Settings</b> — voice, speaking speed, language switching, listening, and in-call limits. Speed is sent to TTS on preview and live calls.</li>
            <li><b>Tests</b> — live Voice or Chat is the real check. Saved scenarios are optional.</li>
            <li><b>Genie</b> — ask it to rewrite greeting, language, or instructions without leaving the studio.</li>
          </ul>
          <p>Click <b>Finish update</b> to save a new version. Unsaved edits stay in the studio until you do.</p>
        </section>

        <section id="knowledge" className="docs-section">
          <h3>Knowledge base</h3>
          <p>
            A knowledge base is a set of files the agent may read on a call. Create one, upload <code>.md</code>, <code>.txt</code>, or <code>.csv</code>,
            then attach it to the agent. On a live call, Query Knowledge Base pulls matching passages instead of guessing.
          </p>
          <ol className="steps">
            <li>Open <Link to="/knowledge">Knowledge base</Link> and create a base. Name it after the agent or campaign, for example <code>mlc-graduates-priya-outbound</code>.</li>
            <li>Upload files, or paste a text note. Status becomes <b>Synced</b> when at least one file is Ready.</li>
            <li>Use <b>Test retrieval</b> on the base: ask a question you expect callers to ask. You should see the file name and the passage the agent would get.</li>
            <li>Attach the base to one or more agents on that page, or from studio <b>Tools</b>.</li>
          </ol>
          <p>If retrieval returns nothing, the file does not contain those words — add the fact, then search again before you go live.</p>
        </section>

        <section id="workflow" className="docs-section">
          <h3>Workflow</h3>
          <p>
            <Link to="/workflows">Workflows</Link> is the call order: greeting, conversation stages, knowledge lookup, hang-up.
            Open an agent’s <b>Workflow</b> tab, create stages, and turn on <b>Use on live calls</b>. The agent will not say stage names out loud.
          </p>
        </section>

        <section id="test" className="docs-section">
          <h3>Test in studio</h3>
          <p>
            Use <b>Test agent</b> in the studio. Chat does not need a microphone. Voice uses the browser mic (Chrome or Edge).
            Language switch works if Settings allow it — say “talk in English” or the Hindi/Telugu equivalent and the agent should stay in that language.
            Speaking speed in Settings should change how the preview sounds.
          </p>
        </section>

        <section id="numbers" className="docs-section">
          <h3>Phone numbers</h3>
          <p>
            On <Link to="/phone-numbers">Phone numbers</Link>, save a workspace mobile for test outbound, then connect Twilio
            (Account SID, Auth Token, From number, public URL such as ngrok on port 8787).
            The voice webhook is <code>/webhooks/twilio/inbound</code> on that public URL.
          </p>
        </section>

        <section id="inbound" className="docs-section">
          <h3>Inbound calls</h3>
          <p>
            <Link to="/inbound">Inbound calls</Link> assigns one agent to the Twilio number. Turn <b>Answer live calls</b> on and save.
            Dial the number from another phone. The transcript appears on that page and in call logs.
            Edit greeting, voice, and instructions in the studio — inbound uses the saved agent, not a separate script.
          </p>
        </section>

        <section id="outbound" className="docs-section">
          <h3>Outbound campaigns</h3>
          <p>
            On <Link to="/campaigns">Outbound campaigns</Link>, create a campaign, pick an agent, paste CSV <code>name,phone,notes</code>,
            then launch. Each row becomes a call. Missed calls go to the recall queue. Pause from the campaign page if you need to stop dialing.
          </p>
        </section>

        <section id="monitor" className="docs-section">
          <h3>Monitor</h3>
          <ul>
            <li><Link to="/calls">Call logs</Link> — every call, transcript, recording, disposition.</li>
            <li><Link to="/boards">Boards</Link> — live calls, recall due, next scheduled dials.</li>
            <li><Link to="/analytics">Agent analytics</Link> — attempted vs connected, latency, duration, outcomes, and agent/campaign tables for a date range.</li>
          </ul>
        </section>

        <section id="code" className="docs-section">
          <h3>Deploy with code</h3>
          <p>
            <Link to="/deploy">Deploy with code</Link> shows a curl example to start the same agent from your CRM or backend.
            The call still lands in Zoco with transcript and recording.
          </p>
          <p className="muted">
            Keys and models live in <Link to="/settings">Settings</Link>. Usage is on <Link to="/usage">Usage</Link>.
          </p>
        </section>
      </article>
    </>
  );
}
