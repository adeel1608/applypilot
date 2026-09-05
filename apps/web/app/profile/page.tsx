import type { Metadata } from "next";

import { exampleProfile } from "@web/lib/data";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">Fictional example · schema v{exampleProfile.schemaVersion}</div>
        <h1>Candidate truth store</h1>
        <p>Only verified facts can flow into generated documents or application answers.</p>
      </section>
      <section className="profile-grid">
        <article className="panel profile-card">
          <span className="section-kicker">Verified foundation</span>
          <h2>
            {exampleProfile.identity.firstName.value} {exampleProfile.identity.lastName.value}
          </h2>
          <dl className="fact-list">
            <div>
              <dt>Location</dt>
              <dd>
                {exampleProfile.location.suburb.value}, {exampleProfile.location.state.value}
              </dd>
            </div>
            <div>
              <dt>Education records</dt>
              <dd>{exampleProfile.education.length}</dd>
            </div>
            <div>
              <dt>Verified skills</dt>
              <dd>
                {
                  exampleProfile.skills.filter(({ verification }) => verification === "VERIFIED")
                    .length
                }
              </dd>
            </div>
            <div>
              <dt>Weekly limit</dt>
              <dd>{exampleProfile.preferences.maximumHoursPerWeek.value} hours</dd>
            </div>
            <div>
              <dt>Maximum commute</dt>
              <dd>{exampleProfile.transport.maximumCommuteKm.value} km</dd>
            </div>
          </dl>
        </article>
        <article className="panel profile-card profile-card--guardrail">
          <span className="section-kicker">Forbidden claim guardrail</span>
          <h2>Explicitly excluded</h2>
          <ul>
            {exampleProfile.forbiddenClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </article>
      </section>
      <section className="safety-banner">
        <div>
          <span className="section-kicker">Private by design</span>
          <h2>Real data stays out of Git.</h2>
        </div>
        <p>
          Use <code>data/profile.private.json</code> locally. This page renders only committed
          fictional fixture data.
        </p>
      </section>
    </div>
  );
}
