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
import Dashboard from "./pages/Dashboard.jsx";
import DeployCode from "./pages/DeployCode.jsx";
import Docs from "./pages/Docs.jsx";
import Inbound from "./pages/Inbound.jsx";
import Knowledge from "./pages/Knowledge.jsx";
import PhoneNumbers from "./pages/PhoneNumbers.jsx";
import Pricing from "./pages/Pricing.jsx";
import Settings from "./pages/Settings.jsx";
import Usage from "./pages/Usage.jsx";

const nav = [
  { section: "Voice agents", items: [["/", "Home"]] },
  {
    section: "Build",
    items: [
      ["/agents", "Agents"],
      ["/knowledge", "Knowledge base"],
    ],
  },
  {
    section: "Deploy",
    items: [
      ["/phone-numbers", "Phone numbers"],
      ["/inbound", "Inbound calls"],
      ["/campaigns", "Outbound campaigns"],
      ["/deploy", "Deploy with code"],
    ],
  },
  {
    section: "Monitor",
    items: [
      ["/analytics", "Agent analytics"],
      ["/boards", "Boards"],
      ["/calls", "Call logs"],
    ],
  },
];

const footer = [
  ["/settings", "Settings"],
  ["/usage", "Usage"],
  ["/pricing", "Pricing"],
  ["/docs", "Documentation"],
];

export default function App() {
  const location = useLocation();

  return (
    <div className="app">
      <div className="waves" aria-hidden="true" />

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
              {group.items.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === "/"}>
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

      <main className="content">
        <div key={location.pathname} className="page">
          <Routes location={location}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/:id" element={<AgentStudio />} />
            <Route path="/knowledge" element={<Knowledge />} />
            <Route path="/phone-numbers" element={<PhoneNumbers />} />
            <Route path="/inbound" element={<Inbound />} />
            <Route path="/campaigns" element={<Campaigns />} />
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
