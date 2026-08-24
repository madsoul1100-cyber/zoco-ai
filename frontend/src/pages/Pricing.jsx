import { PageHeader } from "../components/ui.jsx";

const plans = [
  { name: "Builder", price: "Free", detail: "Studio, browser voice, 500 minutes, one workspace number." },
  { name: "Desk", price: "Usage", detail: "Live Twilio inbound and outbound, campaigns, knowledge bases, recordings." },
  { name: "Agency", price: "Custom", detail: "White-label, higher concurrency, dedicated numbers, SLA." },
];

export default function Pricing() {
  return (
    <>
      <PageHeader
        title="Pricing"
        subtitle="Start in the studio. Pay when you put a real number on an agent."
      />
      <div className="grid trio">
        {plans.map((plan) => (
          <article key={plan.name} className="card">
            <div className="stat-label">{plan.name}</div>
            <div className="stat-value" style={{ fontSize: 28 }}>{plan.price}</div>
            <p className="muted">{plan.detail}</p>
          </article>
        ))}
      </div>
    </>
  );
}
