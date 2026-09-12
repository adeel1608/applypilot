import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Fictional application packet" };

const packetRows = [
  ["Job version", "Robotics Engineer / observation v2", "CURRENT"],
  ["Candidate facts", "Truth store / profile v4", "CURRENT"],
  ["CV", "Robotics template / document v3", "APPROVED"],
  ["Cover letter", "Not required by source evidence", "NOT REQUIRED"],
  ["Answers", "8 verified · 1 owner confirmation", "REVIEW"],
  ["Disclosures", "2 allowed · 1 undecided", "REVIEW"],
  ["Target", "Northstar demo portal / form v2", "BOUND"],
] as const;

export default function PacketPage() {
  return (
    <div className="page-shell packet-page">
      <section className="page-heading page-heading--packet">
        <div>
          <p className="demo-flag">
            <span aria-hidden="true" /> Public demo — fictional data
          </p>
          <p className="mono-label">Frozen packet / AP-DEMO-003</p>
          <h1>
            Ready for review.
            <br />
            <em>Not ready to send.</em>
          </h1>
        </div>
        <div className="packet-status">
          <span>FINAL ACTION</span>
          <strong>HUMAN CONSENT REQUIRED</strong>
          <small>No external destination is contacted in this demo.</small>
        </div>
      </section>

      <section className="packet-layout">
        <div className="packet-ledger">
          <div className="panel-heading">
            <div>
              <p className="mono-label">Bound dependencies</p>
              <h2>Application packet</h2>
            </div>
            <span className="state state--review">AWAITING REVIEW</span>
          </div>
          <div className="packet-rows">
            {packetRows.map(([label, value, state]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small className={state === "REVIEW" ? "text-review" : "text-ready"}>{state}</small>
              </div>
            ))}
          </div>
        </div>

        <aside className="approval-panel">
          <p className="mono-label">Human control gate</p>
          <h2>What still blocks action</h2>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Confirm one unknown answer</strong>
                <p>Availability for occasional after-hours testing.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Choose disclosure state</strong>
                <p>Permission to share one verified candidate fact remains undecided.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Revalidate target</strong>
                <p>Form version and destination must still match at open, fill and final review.</p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>Issue fresh final consent</strong>
                <p>Single-use approval exists only immediately before an irreversible action.</p>
              </div>
            </li>
          </ol>
          <div className="disabled-action" aria-disabled="true">
            <span>Submit application</span>
            <small>Unavailable · review incomplete</small>
          </div>
        </aside>
      </section>

      <section className="packet-safety-grid">
        <article>
          <span>VERSION DRIFT</span>
          <strong>STOP</strong>
          <p>
            A changed job, profile, document, answer, disclosure, target or form invalidates
            readiness.
          </p>
        </article>
        <article>
          <span>CAPTCHA / MFA / AUTH</span>
          <strong>STOP</strong>
          <p>
            Protection boundaries require legitimate owner action. ApplyPilot never bypasses them.
          </p>
        </article>
        <article>
          <span>AMBIGUOUS RESPONSE</span>
          <strong>OUTCOME UNKNOWN</strong>
          <p>A lost result is recorded and never retried blindly.</p>
        </article>
      </section>

      <section className="consent-chain">
        <p className="mono-label">Irreversible boundary</p>
        <div>
          <span>Frozen packet</span>
          <i aria-hidden="true">→</i>
          <span>Target revalidation</span>
          <i aria-hidden="true">→</i>
          <span>Human final review</span>
          <i aria-hidden="true">→</i>
          <strong>One-use consent</strong>
        </div>
      </section>

      <div className="page-actions">
        <Link className="button button--secondary" href="/demo/evidence">
          ← Evidence model
        </Link>
        <a className="button button--primary" href="https://github.com/adeel1608/applypilot">
          View implementation ↗
        </a>
      </div>
    </div>
  );
}
