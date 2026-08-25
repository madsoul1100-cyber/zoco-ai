import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader, StatusBadge } from "../components/ui.jsx";

export default function CampaignSchedules() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [form, setForm] = useState({ start: "00:00:00", end: "23:59:00", days: "Every day", timezone: "Asia/Kolkata" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.campaign(id).then((item) => {
      setCampaign(item);
      setForm({
        start: item.schedule?.start || "00:00:00",
        end: item.schedule?.end || "23:59:00",
        days: item.schedule?.days || "Every day",
        timezone: item.schedule?.timezone || "Asia/Kolkata",
      });
    }).catch((err) => setError(err.message));
  }, [id]);

  async function save(event) {
    event.preventDefault();
    setError("");
    const saved = await api.updateCampaign(id, { schedule: form });
    setCampaign(saved);
    setNotice("Schedule saved.");
  }

  if (!campaign) return <p className="muted">Loading schedule…</p>;

  return (
    <>
      <div className="kb-crumb-bar">
        <div className="kb-crumb">
          <Link to="/campaigns">Outbound Campaigns</Link>
          <span>/</span>
          <Link to={`/campaigns/${id}`}>{campaign.name}</Link>
          <span>/</span>
          <strong>Schedules</strong>
        </div>
        <StatusBadge status={campaign.status} />
      </div>
      <PageHeader title="Schedules" subtitle={campaign.scheduleLabel || "When this campaign is allowed to dial."} />
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      <section className="product-sheet">
        <form className="grid" onSubmit={save}>
          <label>Start<input className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
          <label>End<input className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
          <label>Days<input className="input" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></label>
          <label>Timezone<input className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></label>
          <div className="row">
            <button className="btn" type="submit">Save schedule</button>
            <Link className="btn ghost" to={`/campaigns/${id}`}>Back to campaign</Link>
          </div>
        </form>
      </section>
    </>
  );
}
