import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

const safeguards = [
  ["Final submission", "Always requires human confirmation", "Locked"],
  ["LinkedIn discovery", "Assisted / manual only", "Locked"],
  ["Browser sessions", "Future local runner only", "Planned"],
  ["AI provider", "None required", "Off"],
  ["Job sources", "Fictional fixtures only", "Safe"],
] as const;

export default function SettingsPage() {
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">Phase 0/1 policy</div>
        <h1>Settings & safeguards</h1>
        <p>Safety-critical controls are visible and cannot be relaxed in this foundation build.</p>
      </section>
      <section className="panel settings-list">
        {safeguards.map(([label, detail, status]) => (
          <div className="setting-row" key={label}>
            <div>
              <strong>{label}</strong>
              <span>{detail}</span>
            </div>
            <span className="source-pill">{status}</span>
          </div>
        ))}
      </section>
      <section className="panel">
        <span className="section-kicker">Automation stop conditions</span>
        <h2>Human action is required</h2>
        <p>
          CAPTCHA, MFA, authentication challenges, bot detection, rate limits, access controls,
          website restrictions, and unexpected page changes stop future automation.
        </p>
      </section>
    </div>
  );
}
