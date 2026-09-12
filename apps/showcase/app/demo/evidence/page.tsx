import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Evidence model" };

const evidenceStates = [
  ["SOURCE STATED", "The vacancy explicitly contains the requirement."],
  ["VERIFIED", "A candidate fact has an approved truth-store source."],
  ["UNKNOWN", "The available record cannot support yes or no."],
  ["CONFLICTING", "Two current pieces of evidence cannot be reconciled safely."],
] as const;

export default function EvidencePage() {
  return (
    <div className="page-shell evidence-page">
      <section className="page-heading">
        <p className="demo-flag">
          <span aria-hidden="true" /> Public demo — fictional data
        </p>
        <p className="mono-label">Evidence ledger / explained decisions</p>
        <h1>
          Unknown never
          <br />
          <em>means yes.</em>
        </h1>
        <p>
          ApplyPilot keeps job requirements, candidate evidence and decision state separate. A
          missing fact remains reviewable instead of being inferred.
        </p>
      </section>

      <section className="evidence-comparison" aria-label="Two fictional evidence decisions">
        <article className="decision-case decision-case--match">
          <div className="decision-case__number">01 / SUPPORTED</div>
          <span className="state state--match">MATCH</span>
          <div className="decision-field">
            <span>Job requirement</span>
            <strong>C++ experience</strong>
            <small>Source stated · required</small>
          </div>
          <div className="decision-connector" aria-hidden="true">
            <i /> <span>linked by verified fact ID</span>
          </div>
          <div className="decision-field">
            <span>Candidate evidence</span>
            <strong>Verified robotics project</strong>
            <small>Project evidence · verified</small>
          </div>
          <p className="decision-result">
            This evidence may support eligibility and fit. The generated claim cannot exceed the
            verified project record.
          </p>
        </article>

        <article className="decision-case decision-case--review">
          <div className="decision-case__number">02 / UNRESOLVED</div>
          <span className="state state--review">REVIEW REQUIRED</span>
          <div className="decision-field">
            <span>Job requirement</span>
            <strong>Australian citizenship required</strong>
            <small>Source stated · required</small>
          </div>
          <div className="decision-connector" aria-hidden="true">
            <i /> <span>no evidence link</span>
          </div>
          <div className="decision-field">
            <span>Candidate evidence</span>
            <strong>UNKNOWN</strong>
            <small>Candidate fact · absent</small>
          </div>
          <p className="decision-result">
            The result is never silently eligible or ineligible. The owner must provide evidence or
            skip the role.
          </p>
        </article>
      </section>

      <section className="evidence-principles">
        <div>
          <p className="mono-label">Closed evidence states</p>
          <h2>Meaning stays explicit.</h2>
        </div>
        <dl>
          {evidenceStates.map(([term, detail]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="explanation-chain">
        <p className="mono-label">Decision trace / fictional role</p>
        <h2>Robotics Engineer — why 92?</h2>
        <div className="contribution-list">
          <div>
            <span>+24</span>
            <strong>Verified technical skills</strong>
            <small>C++ · robotics · systems testing</small>
          </div>
          <div>
            <span>+18</span>
            <strong>Project relevance</strong>
            <small>Motion planning and control evidence</small>
          </div>
          <div>
            <span>+12</span>
            <strong>Education alignment</strong>
            <small>Verified mechatronics qualification</small>
          </div>
          <div className="negative">
            <span>−4</span>
            <strong>Schedule uncertainty</strong>
            <small>After-hours availability needs review</small>
          </div>
        </div>
        <p className="calibration-note">
          Fit is explainable, not predictive. Public demo values are fictional and the real
          calibration state remains uncalibrated until private safety gates pass.
        </p>
      </section>

      <div className="page-actions">
        <Link className="button button--secondary" href="/demo">
          ← Back to dashboard
        </Link>
        <Link className="button button--primary" href="/demo/application-packet">
          Continue to packet →
        </Link>
      </div>
    </div>
  );
}
