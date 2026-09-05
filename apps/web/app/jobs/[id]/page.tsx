import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ScoreBadge } from "@web/components/score-badge";
import { StatusPill } from "@web/components/status-pill";
import { evaluatedJobs, formatDiscoveryDate, getEvaluatedJob, getImportedJob } from "@web/lib/data";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return evaluatedJobs.map(({ job }) => ({ id: job.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = getEvaluatedJob(id);
  return { title: result?.job.title ?? getImportedJob(id)?.title ?? "Job not found" };
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = getEvaluatedJob(id);
  const imported = result ? undefined : getImportedJob(id);
  if (imported) {
    const provenance = imported.sourceMetadata.provenance as
      | { acquisitionMethod?: string; importId?: string; parserVersion?: string }
      | undefined;
    return (
      <div className="page-stack">
        <Link className="back-link" href="/jobs">
          ← Back to jobs
        </Link>
        <section className="job-hero">
          <div>
            <div className="eyebrow">Imported · {imported.category}</div>
            <h1>{imported.title}</h1>
            <p>
              {imported.company} · {imported.location} ·{" "}
              {imported.employmentType.replaceAll("_", " ")}
            </p>
            <div className="inline-pills">
              {imported.eligibilityStatus && <StatusPill status={imported.eligibilityStatus} />}
              <span className="source-pill">Detected source: {imported.source}</span>
              <span className="source-pill">
                Acquisition:{" "}
                {String(provenance?.acquisitionMethod ?? "UNKNOWN").replaceAll("_", " ")}
              </span>
            </div>
          </div>
          {imported.fitScore === null ? (
            <span className="source-pill">Not evaluated</span>
          ) : (
            <ScoreBadge score={imported.fitScore} />
          )}
        </section>
        {imported.eligibilityStatus === null && (
          <section className="safety-banner">
            <div>
              <span className="section-kicker">Evaluation unavailable</span>
              <h2>Not evaluated</h2>
            </div>
            <p>Private candidate profile required for eligibility and fit analysis.</p>
          </section>
        )}
        {imported.eligibilityStatus && imported.fitScore !== null && (
          <section className="panel">
            <span className="section-kicker">Private-profile analysis</span>
            <h2>
              {imported.eligibilityStatus.replaceAll("_", " ")} · {imported.fitScore} / 100
            </h2>
            <ul className="plain-reasons">
              {[...imported.eligibilityReasons, ...imported.fitReasons].map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </section>
        )}
        <section className="detail-grid">
          <article className="panel">
            <span className="section-kicker">Role brief</span>
            <h2>Imported description</h2>
            <p>{imported.description}</p>
          </article>
          <article className="panel">
            <span className="section-kicker">Local provenance</span>
            <h2>Confirmed user-supplied content</h2>
            <dl className="fact-list">
              <div>
                <dt>Detected source</dt>
                <dd>{imported.source}</dd>
              </div>
              <div>
                <dt>Acquisition method</dt>
                <dd>{String(provenance?.acquisitionMethod ?? "UNKNOWN").replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Import ID</dt>
                <dd>{String(provenance?.importId ?? "Unavailable")}</dd>
              </div>
              <div>
                <dt>Parser version</dt>
                <dd>{String(provenance?.parserVersion ?? "Unavailable")}</dd>
              </div>
              <div>
                <dt>Source URL</dt>
                <dd>
                  {imported.sourceUrl ? (
                    <a href={imported.sourceUrl} rel="noreferrer" target="_blank">
                      Open source
                    </a>
                  ) : (
                    "No source URL supplied"
                  )}
                </dd>
              </div>
            </dl>
          </article>
        </section>
      </div>
    );
  }
  if (!result) notFound();
  const { job, eligibility, fit, recommendedTemplate, recommendedAction } = result;
  const missingSkills = fit.contributions
    .filter(({ category, points }) => category === "skills" && points < 0)
    .map(({ explanation }) => explanation.replace("No verified match for: ", ""));

  return (
    <div className="page-stack">
      <Link className="back-link" href="/jobs">
        ← Back to jobs
      </Link>
      <section className="job-hero">
        <div>
          <div className="eyebrow">{job.category}</div>
          <h1>{job.title}</h1>
          <p>
            {job.company} · {job.location} · {job.employmentType.replaceAll("_", " ")}
          </p>
          <div className="inline-pills">
            <StatusPill status={eligibility.status} />
            <span className="source-pill">
              {job.source} ·{" "}
              {String(job.sourceMetadata.accessMode ?? "fixture").replaceAll("_", " ")}
            </span>
          </div>
        </div>
        <ScoreBadge score={fit.score} />
      </section>

      <section className="detail-grid">
        <article className="panel">
          <span className="section-kicker">Decision</span>
          <h2>{recommendedAction}</h2>
          <dl className="fact-list">
            <div>
              <dt>CV template</dt>
              <dd>{recommendedTemplate}</dd>
            </div>
            <div>
              <dt>Work rights</dt>
              <dd>{job.workRightsRequirement.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>{job.schedule.summary ?? "Not specified"}</dd>
            </div>
            <div>
              <dt>Commute</dt>
              <dd>
                {job.estimatedCommuteKm === null
                  ? "Unknown"
                  : `${job.estimatedCommuteKm} km estimated`}
              </dd>
            </div>
            <div>
              <dt>Cover letter</dt>
              <dd>
                {job.source === "SEEK" && job.sourceMetadata.coverLetterRequired === null
                  ? "Unknown"
                  : job.coverLetterRequired
                    ? "Required"
                    : "Not required"}
              </dd>
            </div>
            <div>
              <dt>Source URL</dt>
              <dd>
                {job.sourceUrl ? (
                  <a href={job.sourceUrl} rel="noreferrer" target="_blank">
                    Open source
                  </a>
                ) : (
                  "No source URL supplied"
                )}
              </dd>
            </div>
            <div>
              <dt>Date discovered</dt>
              <dd>{formatDiscoveryDate(job.dateDiscovered)}</dd>
            </div>
            <div>
              <dt>Date posted</dt>
              <dd>{job.datePosted ? formatDiscoveryDate(job.datePosted) : "Unknown"}</dd>
            </div>
            <div>
              <dt>Last refreshed</dt>
              <dd>
                {typeof job.sourceMetadata.fetchedAt === "string"
                  ? formatDiscoveryDate(job.sourceMetadata.fetchedAt)
                  : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt>Provenance</dt>
              <dd>
                {String(
                  (job.sourceMetadata.provenance as { retrievalMethod?: unknown } | undefined)
                    ?.retrievalMethod ?? "FIXTURE",
                ).replaceAll("_", " ")}
              </dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <span className="section-kicker">Eligibility reasoning</span>
          <h2>{eligibility.status.replaceAll("_", " ")}</h2>
          <ul className="reason-list">
            {eligibility.reasons.map((reason) => (
              <li
                key={`${reason.code}-${reason.message}`}
                className={`reason reason--${reason.severity.toLowerCase()}`}
              >
                <strong>{reason.code.replaceAll("_", " ")}</strong>
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="detail-grid">
        <article className="panel">
          <span className="section-kicker">Role brief</span>
          <h2>What the employer describes</h2>
          <p>{job.description}</p>
          <h3>Responsibilities</h3>
          <ul>
            {job.responsibilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <span className="section-kicker">Fit explanation</span>
          <h2>Why {fit.score} / 100</h2>
          <ul className="plain-reasons positive-list">
            {fit.positive.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <ul className="plain-reasons negative-list">
            {fit.negative.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel">
        <div className="requirements-grid">
          <div>
            <h3>Required skills</h3>
            <ul>
              {job.requiredSkills.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Missing verified skills</h3>
            {missingSkills.length ? (
              <ul>
                {missingSkills.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>None detected.</p>
            )}
          </div>
          <div>
            <h3>Requirements</h3>
            <ul>
              {job.requirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="action-bar" aria-label="Fixture actions">
        <div>
          <strong>Preparation controls</strong>
          <span>Demonstration only · no live submission</span>
        </div>
        <button className="button button--quiet" type="button" disabled>
          Skip
        </button>
        <button className="button button--secondary" type="button" disabled>
          Shortlist
        </button>
        <button className="button button--secondary" type="button" disabled>
          Generate CV
        </button>
        <button className="button button--primary" type="button" disabled>
          Prepare application
        </button>
      </section>
    </div>
  );
}
