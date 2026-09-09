import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  approveDocumentAction,
  correctJobAction,
  generateCoverLetterAction,
  generateCvAction,
  preparePacketAction,
  reevaluateJobAction,
  setQueueStateAction,
} from "@web/app/jobs/actions";
import { ScoreBadge } from "@web/components/score-badge";
import { StatusPill } from "@web/components/status-pill";
import { coverLetterRequirementStatus, coverLetterTones } from "@applypilot/cover-letter-engine";
import { resumeTemplateCategories, resumeTemplateDesigns } from "@applypilot/resume-engine";
import {
  getBetaJob,
  getBetaResumeEvidencePreview,
  type BetaJobDetail,
} from "@web/lib/beta-workspace";
import { evaluatedJobs, formatDiscoveryDate, getEvaluatedJob, getImportedJob } from "@web/lib/data";
import { issueLocalMutationNonce } from "@web/lib/local-mutation-security";

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
  return {
    title:
      result?.job.title ??
      getBetaJob(id)?.job.title ??
      getImportedJob(id)?.title ??
      "Job not found",
  };
}

async function BetaJobWorkspace({ detail }: { detail: BetaJobDetail }) {
  const path = `/jobs/${detail.job.id}`;
  const [queueNonce, evaluateNonce, correctionNonce, generateNonce, coverLetterNonce, packetNonce] =
    await Promise.all([
      issueLocalMutationNonce("JOB_QUEUE", path),
      issueLocalMutationNonce("JOB_REEVALUATE", path),
      issueLocalMutationNonce("JOB_CORRECT", path),
      issueLocalMutationNonce("DOCUMENT_GENERATE", path),
      issueLocalMutationNonce("COVER_LETTER_GENERATE", path),
      issueLocalMutationNonce("PACKET_PREPARE", path),
    ]);
  const approvalNonces = await Promise.all(
    detail.documents.map(() => issueLocalMutationNonce("DOCUMENT_APPROVE", path)),
  );
  const { job } = detail;
  const currentCvTemplate = detail.documents.find(
    ({ type, stale }) => type === "CV" && !stale,
  )?.template;
  const previewTemplate =
    resumeTemplateCategories.find((template) => template === currentCvTemplate) ??
    detail.recommendedTemplate;
  const evidencePreview = await getBetaResumeEvidencePreview(job.id, previewTemplate);
  return (
    <div className="page-stack">
      <Link className="back-link" href="/jobs">
        ← Back to jobs
      </Link>
      <section className="job-hero">
        <div>
          <div className="eyebrow">Private local job · {job.category}</div>
          <h1>{job.title}</h1>
          <p>
            {job.company} · {job.location} · {job.employmentType.replaceAll("_", " ")}
          </p>
          <div className="inline-pills">
            {detail.eligibilityStatus ? (
              <StatusPill status={detail.eligibilityStatus} />
            ) : (
              <span className="source-pill">Evaluation required</span>
            )}
            <span className="source-pill">Queue: {detail.queueState ?? "Not reviewed"}</span>
            {detail.evaluationStale && <span className="source-pill">Stale evaluation</span>}
          </div>
        </div>
        {detail.fitScore === null ? (
          <span className="source-pill">Fit unavailable</span>
        ) : (
          <ScoreBadge score={detail.fitScore} />
        )}
      </section>

      <section className="action-bar" aria-label="Local job actions">
        <div>
          <strong>Owner-controlled local workflow</strong>
          <span>No source fetch, employer form, upload, or submission</span>
        </div>
        <form action={setQueueStateAction}>
          <input type="hidden" name="mutationNonce" value={queueNonce} />
          <input type="hidden" name="jobId" value={job.id} />
          <button className="button button--quiet" name="queueState" value="SKIP">
            Skip
          </button>
          <button className="button button--quiet" name="queueState" value="ARCHIVE">
            Archive
          </button>
          <button className="button button--secondary" name="queueState" value="REVIEW_LATER">
            Review later
          </button>
          <button className="button button--secondary" name="queueState" value="SHORTLIST">
            Shortlist
          </button>
        </form>
      </section>

      <section className="detail-grid">
        <article className="panel">
          <span className="section-kicker">Evaluation version</span>
          <h2>{detail.eligibilityStatus?.replaceAll("_", " ") ?? "Not evaluated"}</h2>
          {detail.coverage && (
            <p>
              Coverage {detail.coverage.percent}% · {detail.coverage.confidence.toLowerCase()}{" "}
              confidence
            </p>
          )}
          {detail.coverage?.missingDimensions.length ? (
            <p>Missing or ambiguous: {detail.coverage.missingDimensions.join(", ")}</p>
          ) : null}
          <ul className="reason-list">
            {detail.eligibilityReasons.map((reason) => (
              <li key={`${reason.code}-${reason.message}`}>
                <strong>{reason.code.replaceAll("_", " ")}</strong>
                <span>{reason.message}</span>
              </li>
            ))}
          </ul>
          <form action={reevaluateJobAction}>
            <input type="hidden" name="mutationNonce" value={evaluateNonce} />
            <input type="hidden" name="jobId" value={job.id} />
            <button className="button button--secondary">Re-evaluate current versions</button>
          </form>
        </article>
        <article className="panel">
          <span className="section-kicker">Fit explanation</span>
          <h2>{detail.fitScore === null ? "Unavailable" : `${detail.fitScore} / 100`}</h2>
          <ul className="plain-reasons">
            {detail.fitContributions.map((contribution) => (
              <li key={`${contribution.category}-${contribution.explanation}`}>
                {contribution.points > 0 ? "+" : ""}
                {contribution.points} · {contribution.explanation}
              </li>
            ))}
          </ul>
          <dl className="fact-list compact-facts">
            <div>
              <dt>Job version</dt>
              <dd>{detail.jobVersionId ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Evaluation version</dt>
              <dd>{detail.evaluationVersionId ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Duplicate review</dt>
              <dd>{detail.duplicateState?.replaceAll("_", " ") ?? "No cluster suggested"}</dd>
            </div>
            <div>
              <dt>Next action</dt>
              <dd>
                {detail.evaluationStale
                  ? "Re-evaluate current versions"
                  : detail.queueReason === "OWNER_ARCHIVED"
                    ? "Archived; restore by choosing review later"
                    : "Owner review and document preparation"}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="detail-grid">
        <article className="panel">
          <span className="section-kicker">Original source and normalized review</span>
          <h2>Role evidence</h2>
          <p>{job.description}</p>
          {detail.requirements.length ? (
            <dl className="fact-list">
              {detail.requirements.map((requirement, index) => (
                <div key={`${requirement.kind}-${index}`}>
                  <dt>
                    {requirement.kind.replaceAll("_", " ")} · {requirement.modality} ·{" "}
                    {requirement.certainty}
                  </dt>
                  <dd>
                    Source: {requirement.originalText}
                    <br />
                    Normalized: {requirement.normalizedProposition}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>No typed requirement spans were retained for this legacy observation.</p>
          )}
        </article>
        <article className="panel">
          <span className="section-kicker">Owner correction overlay</span>
          <h2>Correct selected fields</h2>
          <p>The source observation remains immutable; a correction creates a new job version.</p>
          <form action={correctJobAction} className="import-form">
            <input type="hidden" name="mutationNonce" value={correctionNonce} />
            <input type="hidden" name="jobId" value={job.id} />
            <label>
              Title
              <input name="title" defaultValue={job.title} required maxLength={300} />
            </label>
            <label>
              Company
              <input name="company" defaultValue={job.company} required maxLength={300} />
            </label>
            <label>
              Location
              <input name="location" defaultValue={job.location} required maxLength={500} />
            </label>
            <label>
              Category
              <input name="category" defaultValue={job.category} required maxLength={300} />
            </label>
            <button className="button button--secondary">Save correction and re-evaluate</button>
          </form>
        </article>
      </section>

      <section className="panel" data-testid="r2a-evidence-layer">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">R2A extraction truth layer</span>
            <h2>Evidence, conflicts, and coverage</h2>
          </div>
          <span className="source-pill">
            {detail.r2a ? `Parser ${detail.r2a.parserVersion}` : "R2A unavailable"}
          </span>
        </div>
        <p>
          This evidence contract is separate from the existing fit and eligibility engine. It does
          not make R2B rule outcomes or candidate eligibility claims.
        </p>
        <dl className="fact-list compact-facts">
          {detail.jobVersions.map((version) => (
            <div key={version.id}>
              <dt>Job version {version.version}</dt>
              <dd>
                {version.id} ·{" "}
                {version.r2aCoverageCount === 17 ? "R2A evidence" : "legacy evidence"}
              </dd>
            </div>
          ))}
        </dl>
        {detail.r2a ? (
          <>
            <div className="detail-grid">
              <div>
                <h3>Version contract</h3>
                <p>
                  Evidence {detail.r2a.evidenceContractVersion} · normalization{" "}
                  {detail.r2a.normalizationVersion}
                </p>
              </div>
              <div>
                <h3>Conflicts</h3>
                {detail.r2a.conflicts.length ? (
                  <ul>
                    {detail.r2a.conflicts.map((conflict) => (
                      <li key={conflict.id}>
                        {conflict.canonicalField.replaceAll("_", " ")} · {conflict.evidenceCount}{" "}
                        linked records
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No material extraction conflict is recorded.</p>
                )}
              </div>
              <div>
                <h3>Unknown sections</h3>
                <p>
                  {detail.r2a.coverage
                    .filter(({ state }) => state === "UNKNOWN")
                    .map(({ family }) => family.replaceAll("_", " "))
                    .join(", ") || "None"}
                </p>
              </div>
            </div>
            <h3>Field-family coverage</h3>
            <div className="inline-pills">
              {detail.r2a.coverage.map((coverage) => (
                <span className="source-pill" key={coverage.family}>
                  {coverage.family.replaceAll("_", " ")}: {coverage.state} ·{" "}
                  {coverage.evidenceCount} evidence · {coverage.unparsedSpanCount} unparsed
                </span>
              ))}
            </div>
            <h3>Typed field evidence</h3>
            {detail.r2a.fields.length ? (
              <dl className="fact-list">
                {detail.r2a.fields.map((evidence) => (
                  <div key={evidence.id}>
                    <dt>
                      {evidence.canonicalField} · {evidence.state}
                      {evidence.modality ? ` · ${evidence.modality}` : ""} ·{" "}
                      {evidence.normalizedKind}
                    </dt>
                    <dd>
                      Bounded source [{evidence.start}, {evidence.end}):{" "}
                      {evidence.excerpt ||
                        "No copied source text; linked owner/legacy provenance only"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>No current typed field evidence.</p>
            )}
            <h3>Typed requirement evidence</h3>
            {detail.r2a.requirements.length ? (
              <dl className="fact-list">
                {detail.r2a.requirements.map((evidence) => (
                  <div key={evidence.id}>
                    <dt>
                      {evidence.canonicalKind.replaceAll("_", " ")} · {evidence.state} ·{" "}
                      {evidence.modality} · {evidence.normalizedKind}
                    </dt>
                    <dd>
                      Bounded source [{evidence.start}, {evidence.end}): {evidence.excerpt}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>No current typed requirement evidence.</p>
            )}
          </>
        ) : (
          <p>The current job version predates verified R2A evidence or schema migration.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Private document artifacts</span>
            <h2>CV generation and approval</h2>
          </div>
          <span className="source-pill">
            Cover letter: {coverLetterRequirementStatus(job).replaceAll("_", " ")}
          </span>
        </div>
        <p>
          Generation creates new versioned PDF and DOCX files below the ignored private document
          root. Filenames and contents are never placed in Git.
        </p>
        <div className="detail-grid">
          <div>
            <h3>Recommended template</h3>
            <p>
              {detail.recommendedTemplate} · {detail.templateStrategy.toLowerCase()} strategy
            </p>
            <p>Evidence priorities: {detail.templateEvidencePriorities.join(", ") || "general"}.</p>
          </div>
          <div>
            <h3>Unsupported or unknown gaps</h3>
            <p>
              {detail.coverage?.missingDimensions.length
                ? detail.coverage.missingDimensions.join(", ")
                : "No coverage gaps recorded for the current evaluation."}
            </p>
          </div>
          <div>
            <h3>Verified evidence preview</h3>
            {evidencePreview.state === "READY" ? (
              <ul>
                {evidencePreview.claims.map((claim) => (
                  <li key={`${claim.text}-${claim.factReferences.join("-")}`}>
                    {claim.text} <small>({claim.factReferences.join(", ")})</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{evidencePreview.state.replaceAll("_", " ")}.</p>
            )}
            <p>
              Preview template: {evidencePreview.template}. The selected generation override is
              validated again before a new immutable artifact is written.
            </p>
          </div>
        </div>
        <form action={generateCvAction} className="import-form">
          <input type="hidden" name="mutationNonce" value={generateNonce} />
          <input type="hidden" name="jobId" value={job.id} />
          <label>
            CV template override
            <select name="template" defaultValue={detail.recommendedTemplate}>
              {resumeTemplateCategories.map((template) => (
                <option key={template} value={template}>
                  {template.replaceAll("-", " ")} ·{" "}
                  {resumeTemplateDesigns[template].summaryStrategy.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <button className="button button--secondary" disabled={evidencePreview.state !== "READY"}>
            {detail.documents.length ? "Regenerate private CV" : "Generate private CV"}
          </button>
        </form>
        {coverLetterRequirementStatus(job) !== "NOT_REQUIRED" && (
          <form action={generateCoverLetterAction} className="import-form">
            <input type="hidden" name="mutationNonce" value={coverLetterNonce} />
            <input type="hidden" name="jobId" value={job.id} />
            <label>
              Cover-letter tone
              <select name="tone" defaultValue="DIRECT">
                {coverLetterTones.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button--secondary"
              disabled={evidencePreview.state !== "READY"}
            >
              Generate private cover letter for owner review
            </button>
          </form>
        )}
        <div className="job-list">
          {detail.documents.map((document, index) => (
            <article className="job-row" key={document.id}>
              <div className="job-row__main">
                <h3>
                  {document.type} {document.format} v{document.version}
                </h3>
                <p>
                  {document.template} · {document.status.replaceAll("_", " ")} · evidence refs{" "}
                  {document.claimEvidenceCount}
                </p>
                <p>
                  Renderer {document.rendererVersion ?? "unrecorded"} · claims{" "}
                  {document.claimRuleVersion ?? "unrecorded"}
                </p>
                {!document.stale && (
                  <p>
                    {document.format === "PDF" && (
                      <>
                        <a
                          href={`/documents/${encodeURIComponent(document.id)}?disposition=inline`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open PDF preview
                        </a>{" "}
                        Â·{" "}
                      </>
                    )}
                    <a
                      href={`/documents/${encodeURIComponent(document.id)}?disposition=attachment`}
                    >
                      Download {document.format}
                    </a>
                  </p>
                )}
              </div>
              {!document.approved && !document.stale && (
                <form action={approveDocumentAction}>
                  <input type="hidden" name="mutationNonce" value={approvalNonces[index]} />
                  <input type="hidden" name="jobId" value={job.id} />
                  <input type="hidden" name="documentArtifactId" value={document.id} />
                  <input type="hidden" name="contentDigest" value={document.contentDigest} />
                  <button className="button button--secondary">Approve exact artifact</button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <span className="section-kicker">Application packet</span>
        <h2>
          {detail.packet
            ? `${detail.packet.status} · version ${detail.packet.version}`
            : "Not prepared"}
        </h2>
        {detail.packet?.blockers.length ? (
          <ul>
            {detail.packet.blockers.map((blocker) => (
              <li key={blocker}>{blocker.replaceAll("_", " ")}</li>
            ))}
          </ul>
        ) : null}
        <p>
          A real local packet deliberately has no approved application destination. Preparation
          stops before any employer form and therefore remains review-required.
        </p>
        <form action={preparePacketAction}>
          <input type="hidden" name="mutationNonce" value={packetNonce} />
          <input type="hidden" name="jobId" value={job.id} />
          <button className="button button--primary">Prepare local packet</button>
        </form>
      </section>
    </div>
  );
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = getEvaluatedJob(id);
  const beta = result ? null : getBetaJob(id);
  if (beta) return <BetaJobWorkspace detail={beta} />;
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
