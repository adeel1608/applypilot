import Link from "next/link";

import { ArchitectureFlow } from "@showcase/components/architecture-flow";
import { demoJobs, demoMetrics } from "@showcase/lib/demo-data";

const workflow = ["Discover", "Evaluate", "Rank", "Prepare", "Review", "Apply"] as const;
const differences = [
  ["Local-first candidate data", "Sensitive facts stay in the owner-controlled local workspace."],
  [
    "Evidence-backed eligibility",
    "Every material decision points to stated job and candidate evidence.",
  ],
  [
    "Explainable fit scoring",
    "Scores retain visible contributions instead of hiding a prediction.",
  ],
  [
    "No invented experience",
    "Unknown, unverified and forbidden claims never become application facts.",
  ],
  [
    "Human approval boundaries",
    "Source reads, target interactions and final action are separately gated.",
  ],
  [
    "Fail-closed automation",
    "Drift, authentication, CAPTCHA, rate limits and ambiguity stop the run.",
  ],
] as const;
const stack = [
  "TypeScript",
  "Next.js",
  "React",
  "SQLite",
  "Drizzle",
  "Zod",
  "Vitest",
  "Playwright",
  "GitHub Actions",
];

export default function HomePage() {
  return (
    <>
      <section className="hero section-shell">
        <div className="hero-copy">
          <p className="demo-flag">
            <span aria-hidden="true" /> Public demo — fictional data
          </p>
          <p className="mono-label">LOCAL-FIRST / EVIDENCE-BOUND / HUMAN-CONTROLLED</p>
          <h1>
            Find better jobs.
            <br />
            <em>Prove the fit.</em>
            <br />
            Stay in control.
          </h1>
          <p className="hero-deck">
            A local-first AI job discovery and application assistant that evaluates opportunities
            using verifiable evidence and keeps humans in control of external actions.
          </p>
          <div className="button-row">
            <Link className="button button--primary" href="/demo">
              Explore demo <span aria-hidden="true">→</span>
            </Link>
            <a className="button button--secondary" href="https://github.com/adeel1608/applypilot">
              View on GitHub <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="hero-status" aria-label="Current product status">
            <span>
              <i className="signal signal--ready" /> Manual local Beta <strong>available</strong>
            </span>
            <span>
              <i className="signal signal--review" /> Source-enabled Beta{" "}
              <strong>under validation</strong>
            </span>
          </div>
        </div>

        <div className="hero-console" aria-label="Fictional opportunity evaluation preview">
          <div className="console-topline">
            <span>OPPORTUNITY / 001</span>
            <span>DEMO RECORD</span>
          </div>
          <div className="console-role">
            <div>
              <small>Northstar Motion Labs</small>
              <h2>Robotics Engineer</h2>
              <p>Melbourne, VIC · Hybrid</p>
            </div>
            <strong>92</strong>
          </div>
          <div className="console-grid">
            <div>
              <span>Eligibility</span>
              <strong>ELIGIBLE</strong>
            </div>
            <div>
              <span>Evidence</span>
              <strong>94%</strong>
            </div>
            <div>
              <span>Recommendation</span>
              <strong>SHORTLIST</strong>
            </div>
          </div>
          <div className="console-evidence">
            <span className="state state--match">MATCH</span>
            <div>
              <strong>C++ experience</strong>
              <p>Verified robotics project</p>
            </div>
          </div>
          <div className="console-evidence">
            <span className="state state--review">REVIEW</span>
            <div>
              <strong>After-hours testing</strong>
              <p>Availability evidence unknown</p>
            </div>
          </div>
          <p className="console-rule">
            <span aria-hidden="true">↳</span> Unknown never means yes.
          </p>
        </div>
      </section>

      <section className="workflow-band" aria-label="ApplyPilot workflow">
        <p className="mono-label">Product workflow</p>
        <ol>
          {workflow.map((item, index) => (
            <li key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {item}
            </li>
          ))}
        </ol>
      </section>

      <section className="section-shell section-block" id="difference">
        <div className="section-intro">
          <p className="mono-label">Why different</p>
          <h2>Proof before polish.</h2>
          <p>
            ApplyPilot treats application quality as a chain of evidence and approvals—not a race to
            fill every blank.
          </p>
        </div>
        <div className="difference-grid">
          {differences.map(([title, detail], index) => (
            <article key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-shell section-block demo-preview" id="demo">
        <div className="section-intro section-intro--wide">
          <div>
            <p className="mono-label">Interactive demo</p>
            <h2>A decision surface, not a black box.</h2>
          </div>
          <Link className="text-link" href="/demo">
            Open the full demo <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="metric-strip">
          {demoMetrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </div>
          ))}
        </div>
        <div className="preview-table">
          <div className="preview-table__head">
            <span>Role</span>
            <span>Evidence</span>
            <span>Eligibility</span>
            <span>Fit</span>
          </div>
          {demoJobs.slice(0, 5).map((job) => (
            <div className="preview-table__row" key={job.id}>
              <div>
                <strong>{job.title}</strong>
                <span>
                  {job.company} · {job.location}
                </span>
              </div>
              <span>{job.evidenceCoverage}%</span>
              <span
                className={`state state--${job.eligibility === "ELIGIBLE" ? "match" : "review"}`}
              >
                {job.eligibility === "ELIGIBLE" ? "Eligible" : "Review"}
              </span>
              <strong className="fit-number">{job.fitScore}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="truth-callout section-shell">
        <p className="mono-label">Evidence philosophy / 01</p>
        <blockquote>“Unknown never means yes.”</blockquote>
        <div className="truth-comparison">
          <article>
            <span className="state state--match">MATCH</span>
            <p>Job requirement</p>
            <h3>C++ experience</h3>
            <p>Evidence</p>
            <strong>Verified robotics project</strong>
          </article>
          <article>
            <span className="state state--review">REVIEW REQUIRED</span>
            <p>Job requirement</p>
            <h3>Australian citizenship required</h3>
            <p>Evidence</p>
            <strong>UNKNOWN</strong>
          </article>
        </div>
        <Link className="text-link" href="/demo/evidence">
          Inspect the evidence model <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="section-shell section-block packet-preview">
        <div className="section-intro">
          <p className="mono-label">Application packet</p>
          <h2>Freeze the facts before action.</h2>
          <p>
            A packet binds the exact job, candidate facts, documents, answers, disclosures and
            target version. Any stale dependency stops preparation.
          </p>
          <Link className="button button--secondary" href="/demo/application-packet">
            View fictional packet
          </Link>
        </div>
        <div className="packet-card">
          <div className="packet-card__header">
            <span>PACKET / AP-DEMO-003</span>
            <span className="state state--review">AWAITING CONSENT</span>
          </div>
          <dl>
            <div>
              <dt>CV version</dt>
              <dd>Robotics / v3 · approved</dd>
            </div>
            <div>
              <dt>Cover letter</dt>
              <dd>Not required</dd>
            </div>
            <div>
              <dt>Answer state</dt>
              <dd>8 verified · 1 unknown</dd>
            </div>
            <div>
              <dt>Target binding</dt>
              <dd>Fictional portal / form v2</dd>
            </div>
            <div>
              <dt>Final action</dt>
              <dd>Human confirmation required</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section-shell section-block architecture-section" id="architecture">
        <div className="section-intro">
          <p className="mono-label">Safety model</p>
          <h2>Authority narrows at every step.</h2>
          <p>
            Discovery authority never becomes application authority. A target approval never becomes
            final-submit consent.
          </p>
        </div>
        <ArchitectureFlow compact />
      </section>

      <section className="stack-band">
        <div className="section-shell">
          <div>
            <p className="mono-label">Inspected stack</p>
            <h2>Built for deterministic local operation.</h2>
          </div>
          <ul>
            {stack.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="closing-cta section-shell">
        <p className="mono-label">Public showcase / fictional data</p>
        <h2>Explore the evidence. Keep the authority.</h2>
        <div className="button-row">
          <Link className="button button--primary" href="/demo">
            Explore demo
          </Link>
          <a className="button button--secondary" href="https://github.com/adeel1608/applypilot">
            Read the source
          </a>
        </div>
      </section>
    </>
  );
}
