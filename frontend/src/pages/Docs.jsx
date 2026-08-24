import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui.jsx";

export default function Docs() {
  return (
    <>
      <PageHeader
        title="Documentation"
        subtitle="Build an agent, ground it in your documents, assign a number, then watch the call JSON."
      />
      <ol className="steps">
        <li><b>Describe</b> the job on <Link to="/agents">Agents</Link>, or pick a template.</li>
        <li><b>Ground</b> answers with a <Link to="/knowledge">knowledge base</Link> and attach it in the studio.</li>
        <li><b>Test</b> in chat or browser voice before a real line is involved.</li>
        <li><b>Get a number</b> on <Link to="/phone-numbers">Phone numbers</Link>, then route <Link to="/inbound">inbound</Link> or launch an <Link to="/campaigns">outbound campaign</Link>.</li>
        <li><b>Monitor</b> transcripts on <Link to="/calls">Call logs</Link> and outcomes on <Link to="/analytics">Analytics</Link>.</li>
      </ol>
      <section className="card">
        <h3>Inbound webhook</h3>
        <p className="muted">Point the Twilio voice URL at <code>/webhooks/twilio/inbound</code>. Zoco creates the call, greets with the assigned agent, and stores every turn.</p>
      </section>
    </>
  );
}
