import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import AgentStudio from "./pages/AgentStudio.jsx";
import Agents from "./pages/Agents.jsx";
import Analytics from "./pages/Analytics.jsx";
import Boards from "./pages/Boards.jsx";
import CallDetail from "./pages/CallDetail.jsx";
import Calling from "./pages/Calling.jsx";
import Calls from "./pages/Calls.jsx";
import CampaignDetail from "./pages/CampaignDetail.jsx";
import Campaigns from "./pages/Campaigns.jsx";
import CampaignSchedules from "./pages/CampaignSchedules.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import DeployCode from "./pages/DeployCode.jsx";
import DndList from "./pages/DndList.jsx";
import Docs from "./pages/Docs.jsx";
import Inbound from "./pages/Inbound.jsx";
import InboundDetail from "./pages/InboundDetail.jsx";
import Knowledge from "./pages/Knowledge.jsx";
import KnowledgeDetail from "./pages/KnowledgeDetail.jsx";
import PhoneNumbers from "./pages/PhoneNumbers.jsx";
import Pricing from "./pages/Pricing.jsx";
import Settings from "./pages/Settings.jsx";
import Usage from "./pages/Usage.jsx";
import Workflows from "./pages/Workflows.jsx";

const nav = [
  { section: "Voice agents", items: [["/", "Home", "home"]] },
  {
    section: "Build",
    items: [
      ["/agents", "Agents", "agents"],
      ["/workflows", "Workflows", "workflows"],
      ["/knowledge", "Knowledge base", "knowledge"],
    ],
  },
  {
    section: "Deploy",
    items: [
      ["/phone-numbers", "Phone numbers", "phone"],
      ["/inbound", "Inbound calls", "inbound"],
      ["/campaigns", "Outbound campaigns", "campaigns"],
      ["/deploy", "Deploy with code", "code"],
    ],
  },
  {
    section: "Monitor",
    items: [
      ["/analytics", "Agent analytics", "analytics"],
      ["/boards", "Boards", "boards"],
      ["/calls", "Call logs", "calls"],
    ],
  },
];

const footer = [
  ["/settings", "Settings"],
  ["/usage", "Usage"],
  ["/pricing", "Pricing"],
  ["/docs", "Documentation"],
];

function NavIcon({ name }) {
  if (name === "home") {
    return <svg viewBox="0 0 24 24" fill="none"><path d="M4 11.5 12 5l8 6.5V20H4v-8.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
  }
  if (name === "agents") {
    return <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M5 19c1.4-3 4-4.5 7-4.5S17.6 16 19 19" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  if (name === "workflows") {
    return <svg viewBox="0 0 24 24" fill="none"><circle cx="7" cy="7" r="2.4" stroke="currentColor" strokeWidth="1.7" /><rect x="14" y="14" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.7" /><path d="M9 8.2 15.2 15" stroke="currentColor" strokeWidth="1.7" /></svg>;
  }
  if (name === "knowledge") {
    return <svg viewBox="0 0 24 24" fill="none"><path d="M6 5h9a3 3 0 0 1 3 3v12H9a3 3 0 0 0-3 3V5z" stroke="currentColor" strokeWidth="1.7" /></svg>;
  }
  if (name === "phone") {
    return <svg viewBox="0 0 24 24" fill="none"><path d="M8 4h8v16H8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M11 18h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  if (name === "inbound") {
    return <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v10M8 10l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 19h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  if (name === "campaigns") {
    return <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M14 7l5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (name === "code") {
    return <svg viewBox="0 0 24 24" fill="none"><path d="M8 8 4 12l4 4M16 8l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (name === "analytics") {
    return <svg viewBox="0 0 24 24" fill="none"><path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  }
  if (name === "boards") {
    return <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="6" height="14" rx="1.4" stroke="currentColor" strokeWidth="1.7" /><rect x="14" y="5" width="6" height="9" rx="1.4" stroke="currentColor" strokeWidth="1.7" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M5 12h14M5 17h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

export default function App() {
  const location = useLocation();
  const isStudio = /^\/agents\/[^/]+$/.test(location.pathname);

  return (
    <div className={isStudio ? "app studio-mode" : "app"}>
      <div className="waves" aria-hidden="true" />

      {isStudio ? null : (
      <aside className="sidebar">
        <div className="brand">
          <div className="mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M4 16c3-6 5-6 8 0s5 6 8 0 5-6 8 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1>Zoco.ai</h1>
            <small>Voice agents</small>
          </div>
        </div>
        <nav className="nav">
          {nav.map((group) => (
            <div key={group.section} className="nav-group">
              <div className="nav-section">{group.section}</div>
              {group.items.map(([to, label, icon]) => (
                <NavLink key={to} to={to} end={to === "/"}>
                  <NavIcon name={icon} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="nav-footer">
          {footer.map(([to, label]) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </div>
      </aside>
      )}

      <main className="content">
        <div key={location.pathname} className="page">
          <Routes location={location}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/:id" element={<AgentStudio />} />
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/knowledge/:id" element={<KnowledgeDetail />} />
            <Route path="/phone-numbers" element={<PhoneNumbers />} />
            <Route path="/inbound" element={<Inbound />} />
            <Route path="/inbound/:id" element={<InboundDetail />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/dnd" element={<DndList />} />
            <Route path="/campaigns/:id/schedules" element={<CampaignSchedules />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/deploy" element={<DeployCode />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/boards" element={<Boards />} />
            <Route path="/calls" element={<Calls />} />
            <Route path="/calls/:id" element={<CallDetail />} />
            <Route path="/calling" element={<Calling />} />
            <Route path="/rules" element={<Settings />} />
            <Route path="/recall" element={<Boards />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/usage" element={<Usage />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/docs" element={<Docs />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
