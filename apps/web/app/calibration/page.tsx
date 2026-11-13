import type { Metadata } from "next";
import {
  R2CalibrationIdSchema,
  R2_OCCUPATIONAL_FAMILIES,
  R2_OCCUPATION_TAXONOMY_VERSION,
  r2CalibrationOwnerAction,
  r2CalibrationCreateBinding,
  r2CalibrationLabelBinding,
  r2CalibrationPairBinding,
} from "@applypilot/fit-scorer";
import { getCalibrationView, type CalibrationMemberView } from "@web/lib/calibration-workspace";
import { requireLocalSession, issueLocalMutationNonce } from "@web/lib/local-mutation-security";
import {
  createCalibrationCampaignAction,
  recordCalibrationLabelAction,
  recordCalibrationPairAction,
  approveCalibrationQualificationAction,
} from "./actions";

export const metadata: Metadata = { title: "Matching calibration" };
export const dynamic = "force-dynamic";

const availabilityText = {
  PROVISIONAL: "Preliminary retained-data checks passed; exact selected preview is still required.",
  RETAINED_SOURCE_MISSING: "Unavailable: the current job has no retained provider payload.",
  UNSUPPORTED_PROVIDER: "Unavailable: this provider is not supported for retained comparison.",
  QUALIFIED_LINEAGE_MISSING: "Unavailable: a qualified completed-run source lineage is missing.",
  OWNER_CORRECTION_UNSUPPORTED: "Unavailable: retained comparison cannot replay owner corrections.",
};

function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
function scalarId(value: string | string[] | undefined): string | undefined {
  const parsed = R2CalibrationIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
function RoleContext({ member }: { member: CalibrationMemberView }) {
  return (
    <div>
      <h3>
        {member.title} — {member.company}
      </h3>
      <p>{member.location}</p>
      <p>
        Original posting: {member.source} / {member.region} / {member.tenant} / {member.externalId}
      </p>
      <p>
        <code>{member.sourceUrl ?? "Source URL not retained"}</code>
      </p>
      <p>
        Job version <code>{member.jobVersionId}</code>; observation{" "}
        <code>{member.sourceObservationId}</code>.
      </p>
      <p>
        Observed {member.observedAt}; verified {member.verifiedAt}. These retained dates are
        unchanged by local parsing.
      </p>
      <p>
        Parser {member.parserVersion}; normalization {member.normalizationVersion}.
      </p>
      <p>
        Unresolved direct duplicate suggestions: {member.unresolvedDirectDuplicateCount}. Review
        identity ambiguity when choosing unique jobs. Packet duplicate clearance is separate.
      </p>
      <details>
        <summary>Read retained duties and requirements</summary>
        <div style={{ whiteSpace: "pre-wrap" }}>{member.description}</div>
      </details>
    </div>
  );
}

export default async function CalibrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLocalSession("/calibration");
  const query = await searchParams;
  const requested =
    typeof query.job === "string" ? [query.job] : Array.isArray(query.job) ? query.job : [];
  const jobIds =
    requested.length <= 300 && requested.every((id) => R2CalibrationIdSchema.safeParse(id).success)
      ? requested
      : [];
  const campaignId = scalarId(query.campaign);
  const view = await getCalibrationView({
    ...(jobIds.length ? { jobIds } : {}),
    ...(campaignId ? { campaignId } : {}),
  });
  const campaign = view.campaign;
  const left = campaign?.members.find((m) => m.id === scalarId(query.left));
  const right = campaign?.members.find((m) => m.id === scalarId(query.right));
  const pair = left && right && left.id !== right.id ? { left, right } : null;
  const priorPair = pair
    ? campaign?.pairs.find(
        (p) =>
          [p.leftComparisonId, p.rightComparisonId].includes(pair.left.id) &&
          [p.leftComparisonId, p.rightComparisonId].includes(pair.right.id),
      )
    : undefined;
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">Private local owner workflow</div>
        <h1>Matching calibration</h1>
        <p>
          Review retained jobs against verified candidate context. Your judgments qualify matching
          evidence; source freshness, a usable approved packet, and real application permission have
          separate gates.
        </p>
      </section>
      {query.notice === "expired" ? (
        <section className="panel" role="alert">
          <h2>Confirmation expired</h2>
          <p>
            No automatic retry was made. Review the current campaign and deliberately choose again
            with a fresh form.
          </p>
        </section>
      ) : query.notice === "rejected" ? (
        <section className="panel" role="alert">
          <h2>Confirmation rejected</h2>
          <p>
            The submitted context could not be accepted. Current durable state is shown below; no
            judgment or approval is inferred.
          </p>
        </section>
      ) : null}
      <section className="panel">
        <h2>Current qualification</h2>
        <p>
          {view.currentQualificationRunId ? (
            <>
              Current private matching qualification: <code>{view.currentQualificationRunId}</code>.
            </>
          ) : (
            "No current private matching qualification is proven."
          )}
        </p>
        {view.safeCode ? (
          <p role="alert">
            <code>{view.safeCode}</code>
          </p>
        ) : null}
        {view.status !== "READY" ? (
          <p>
            Intake requires schema15 and a stored active profile matching the private profile file.
            No demo profile is substituted.
          </p>
        ) : null}
      </section>
      {view.status === "READY" ? (
        <>
          <section className="panel">
            <h2>Verified candidate context</h2>
            <p>
              Only VERIFIED facts are listed. Missing and unknown facts remain unknown. Identity,
              contact details, cookies and raw private files are excluded.
            </p>
            <ul>
              {view.verifiedContext.map((fact, i) => (
                <li key={`${fact.reference}:${i}`}>
                  <code>{fact.reference}</code>: {fact.summary}
                </li>
              ))}
            </ul>
          </section>
          {view.historical ? (
            <section className="panel">
              <h2>Historical comparison snapshots</h2>
              <p>
                This campaign is not current for the installed engines. These unchanged stored
                outcomes are history; they cannot authorize judgments or qualification for the new
                engines. No owner judgments were copied or reinterpreted.
              </p>
              <p>
                Stored parser {view.historical.engine.parserVersion}; scorer{" "}
                {view.historical.engine.scorerVersion}; eligibility{" "}
                {view.historical.engine.eligibilityEngineVersion}.
              </p>
              <h3>Historical label agreement by class</h3>
              <p>
                Aggregate label agreement can hide missed GOOD_MATCH roles. These are stored
                historical outcomes only; they do not prove current recommendation quality.
              </p>
              <ul>
                {view.historical.labelBreakdown.map((slice) => (
                  <li key={slice.ownerLabel}>
                    {slice.ownerLabel}: {slice.agrees}/{slice.compared} compared labels agree
                    {slice.recorded !== slice.compared
                      ? ` (${slice.recorded - slice.compared} incomplete)`
                      : ""}
                    .
                  </li>
                ))}
              </ul>
              <p>
                Positive-match performance must be examined separately from AMBIGUOUS and POOR_MATCH
                agreement. A high total does not establish that useful jobs are found.
              </p>
              <p>
                Historical pair sample: {view.historical.pairDiagnostics.sample}. Historical
                observed pair performance: {view.historical.pairDiagnostics.performance}; agreement{" "}
                {view.historical.pairAgreementBasisPoints}/10000 from{" "}
                {view.historical.comparedPairCount} complete pairs. Strict agreements{" "}
                {view.historical.pairDiagnostics.agrees}; ties{" "}
                {view.historical.pairDiagnostics.ties}; opposite rankings{" "}
                {view.historical.pairDiagnostics.opposite}. Required comparisons{" "}
                {view.historical.pairDiagnostics.requiredComparisons}; required agreements at
                observed sample{" "}
                {view.historical.pairDiagnostics.requiredAgreementsAtObservedSample ??
                  "no measured sample"}
                ; at minimum sample{" "}
                {view.historical.pairDiagnostics.requiredAgreementsAtMinimumSample}.
              </p>
              <p>
                These diagnostics use unchanged stored outcomes and the original precommitted
                thresholds. Sample sufficiency and measured performance are separate; ties count as
                disagreements. More pairs alone do not repair poor agreement. No current
                qualification is inferred.
              </p>
              <ul>
                {view.historical.members.map((m) => (
                  <li key={m.id}>
                    {m.title}: {m.eligibility}; score {m.score}; recommended {String(m.recommended)}
                    ; coverage {m.coveragePercent}%.
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {!campaign ? (
            <section className="panel">
              <h2>Choose unique retained jobs</h2>
              <p>
                Select actual distinct jobs for a new corpus. Availability hints check only
                necessary retained-data conditions. The exact selected preview checks provider,
                identity and parser bindings again before writing; unresolved duplicate suggestions
                remain available for your identity review.
              </p>
              <form method="get" action="/calibration">
                <fieldset>
                  <legend>Retained job candidates (nothing selected by default)</legend>
                  {view.candidates.map((candidate) => (
                    <label key={candidate.jobId} style={{ display: "block" }}>
                      <input
                        type="checkbox"
                        name="job"
                        value={candidate.jobId}
                        disabled={candidate.availabilityHint !== "PROVISIONAL"}
                      />{" "}
                      {candidate.title} — {candidate.company} ({candidate.source ?? "UNKNOWN"}/
                      {candidate.tenant ?? "UNKNOWN"}/{candidate.externalId ?? "UNKNOWN"}) —{" "}
                      {availabilityText[candidate.availabilityHint] ??
                        "Unavailable: retained context must be checked."}
                    </label>
                  ))}
                </fieldset>
                <button type="submit">Preview selected corpus</button>
              </form>
            </section>
          ) : null}
          {view.selection && !campaign ? (
            <section className="panel">
              <h2>Precommit comparison thresholds</h2>
              <p>
                Selected unique jobs: {view.selection.members.length}. Choose thresholds before
                seeing comparison outcomes. These values and the selected final-version corpus are
                immutable after precommit. A new policy requires a new version and campaign.
              </p>
              {view.selection.members.map((member) => (
                <RoleContext key={member.id} member={member} />
              ))}
              <form action={createCalibrationCampaignAction}>
                {view.selection.jobIds.map((jobId) => (
                  <Hidden key={jobId} name="jobId" value={jobId} />
                ))}
                <Hidden name="expectedContextDigest" value={view.selection.contextDigest} />
                <Hidden
                  name="mutationNonce"
                  value={await issueLocalMutationNonce(
                    r2CalibrationOwnerAction(
                      "CREATE",
                      r2CalibrationCreateBinding({
                        jobIds: view.selection.jobIds,
                        expectedContextDigest: view.selection.contextDigest,
                      }),
                    ),
                    "/calibration",
                  )}
                />
                <label>
                  Threshold version <input name="thresholdVersion" required maxLength={100} />
                </label>
                <label>
                  Minimum label agreement (basis points, 0–10000){" "}
                  <input
                    name="minimumLabelAgreementBasisPoints"
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    required
                  />
                </label>
                <label>
                  Minimum pair comparisons (positive){" "}
                  <input
                    name="minimumPairComparisons"
                    type="number"
                    min={1}
                    max={44850}
                    step={1}
                    required
                  />
                </label>
                <label>
                  Minimum pair agreement (basis points, 0–10000){" "}
                  <input
                    name="minimumPairAgreementBasisPoints"
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    required
                  />
                </label>
                <button type="submit">Precommit thresholds and this corpus</button>
              </form>
            </section>
          ) : null}
          <section className="panel">
            <h2>Recorded campaigns</h2>
            {view.campaigns.length ? (
              <ul>
                {view.campaigns.map((row) => (
                  <li key={row.id}>
                    <a href={`/calibration?campaign=${encodeURIComponent(row.id)}`}>
                      {row.thresholdsVersion} — {row.memberCount} jobs — {row.createdAt}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No owner campaign has been recorded.</p>
            )}
          </section>
          {campaign ? (
            <>
              <section className="panel">
                <h2>Owner labels</h2>
                <p>
                  Taxonomy {R2_OCCUPATION_TAXONOMY_VERSION}. Classify by actual duties. UNKNOWN is
                  retained as incomplete and does not count toward four occupational families.
                  Controls stay blank for each deliberate judgment or revision.
                </p>
                <p>
                  Threshold policy {campaign.thresholds.version}: label agreement ≥
                  {campaign.thresholds.minimumLabelAgreementBasisPoints}/10000; at least{" "}
                  {campaign.thresholds.minimumPairComparisons} pairs; pair agreement ≥
                  {campaign.thresholds.minimumPairAgreementBasisPoints}/10000.
                </p>
                {await Promise.all(
                  campaign.members.map(async (member) => {
                    const previous = campaign.labels.find(
                      (label) => label.comparisonId === member.id,
                    );
                    const binding = {
                      campaignId: campaign.id,
                      comparisonId: member.id,
                      expectedContextDigest: campaign.contextDigest,
                      previousEventId: previous?.id ?? null,
                    };
                    return (
                      <article key={member.id}>
                        <RoleContext member={member} />
                        {previous ? (
                          <p>
                            Recorded revision {previous.revision}: {previous.label},{" "}
                            {previous.occupationalFamily}. A new choice appends a revision.
                          </p>
                        ) : (
                          <p>No owner label recorded.</p>
                        )}
                        <form action={recordCalibrationLabelAction}>
                          <Hidden name="campaignId" value={campaign.id} />
                          <Hidden name="comparisonId" value={member.id} />
                          <Hidden name="expectedContextDigest" value={campaign.contextDigest} />
                          <Hidden name="previousEventId" value={previous?.id ?? ""} />
                          <Hidden
                            name="mutationNonce"
                            value={await issueLocalMutationNonce(
                              r2CalibrationOwnerAction("LABEL", r2CalibrationLabelBinding(binding)),
                              "/calibration",
                            )}
                          />
                          <label>
                            Owner match label{" "}
                            <select name="label" defaultValue="" required>
                              <option value="" disabled>
                                Choose a label
                              </option>
                              <option value="GOOD_MATCH">Good match</option>
                              <option value="POOR_MATCH">Poor match</option>
                              <option value="AMBIGUOUS">Ambiguous</option>
                            </select>
                          </label>
                          <label>
                            Occupational family{" "}
                            <select name="occupationalFamily" defaultValue="" required>
                              <option value="" disabled>
                                Choose from duties
                              </option>
                              {Object.entries(R2_OCCUPATIONAL_FAMILIES).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button type="submit">
                            Record my label{previous ? " revision" : ""}
                          </button>
                        </form>
                      </article>
                    );
                  }),
                )}
              </section>
              <section className="panel">
                <h2>Owner pair preferences</h2>
                <p>
                  Select two jobs to see their exact context, then choose your preference. Reversing
                  an existing pair does not create another comparison; score ties remain
                  disagreement.
                </p>
                <form method="get" action="/calibration">
                  <Hidden name="campaign" value={campaign.id} />
                  {(["left", "right"] as const).map((side) => (
                    <label key={side}>
                      {side === "left" ? "First job" : "Second job"}
                      <select name={side} defaultValue="" required>
                        <option value="" disabled>
                          Choose a job
                        </option>
                        {campaign.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.title} — {m.company}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <button type="submit">View pair context</button>
                </form>
                {pair ? (
                  <article>
                    <RoleContext member={pair.left} />
                    <RoleContext member={pair.right} />
                    {priorPair ? (
                      <p>
                        Recorded preference revision {priorPair.revision}; the next choice appends a
                        revision.
                      </p>
                    ) : null}
                    <form action={recordCalibrationPairAction}>
                      <Hidden name="campaignId" value={campaign.id} />
                      <Hidden name="leftComparisonId" value={pair.left.id} />
                      <Hidden name="rightComparisonId" value={pair.right.id} />
                      <Hidden name="expectedContextDigest" value={campaign.contextDigest} />
                      <Hidden name="previousEventId" value={priorPair?.id ?? ""} />
                      <Hidden
                        name="mutationNonce"
                        value={await issueLocalMutationNonce(
                          r2CalibrationOwnerAction(
                            "PAIR",
                            r2CalibrationPairBinding({
                              campaignId: campaign.id,
                              leftComparisonId: pair.left.id,
                              rightComparisonId: pair.right.id,
                              expectedContextDigest: campaign.contextDigest,
                              previousEventId: priorPair?.id ?? null,
                            }),
                          ),
                          "/calibration",
                        )}
                      />
                      <fieldset>
                        <legend>My preferred job</legend>
                        <label>
                          <input
                            type="radio"
                            name="preferredComparisonId"
                            value={pair.left.id}
                            required
                          />{" "}
                          {pair.left.title} — {pair.left.company}
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="preferredComparisonId"
                            value={pair.right.id}
                            required
                          />{" "}
                          {pair.right.title} — {pair.right.company}
                        </label>
                      </fieldset>
                      <button type="submit">
                        Record my preference{priorPair ? " revision" : ""}
                      </button>
                    </form>
                  </article>
                ) : null}
                <ul>
                  {campaign.pairs.map((p) => (
                    <li key={p.id}>
                      <a
                        href={`/calibration?campaign=${encodeURIComponent(campaign.id)}&left=${encodeURIComponent(p.leftComparisonId)}&right=${encodeURIComponent(p.rightComparisonId)}`}
                      >
                        Review recorded pair revision {p.revision}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="panel">
                <h2>Qualification assessment</h2>
                <p>
                  State before separate owner approval: {campaign.assessment.state}. Complete labels{" "}
                  {campaign.assessment.comparedLabelCount}/{campaign.assessment.sourceLabelCount};
                  occupational families {campaign.assessment.roleFamilyCount}/4; eligibility
                  statuses {campaign.assessment.statusCount}/3; complete pairs{" "}
                  {campaign.assessment.comparedPairCount}/{campaign.assessment.sourcePairCount}.
                </p>
                <p>
                  Label agreement {campaign.assessment.labelAgreementBasisPoints}/10000; pair
                  agreement {campaign.assessment.pairAgreementBasisPoints}/10000.
                </p>
                <h3>Current label agreement by class</h3>
                <p>
                  Aggregate agreement can conceal missed GOOD_MATCH jobs. These class counts are
                  read-only diagnostics from this campaign, not a separate qualification or
                  authority to recommend, prepare or submit an application.
                </p>
                <ul>
                  {campaign.labelBreakdown.map((group) => (
                    <li key={group.ownerLabel}>
                      {group.ownerLabel}: {group.agrees}/{group.compared} compared labels agree
                      {group.recorded !== group.compared
                        ? ` (${group.recorded - group.compared} incomplete)`
                        : ""}
                      .
                    </li>
                  ))}
                </ul>
                <h3>Why desirable jobs were missed</h3>
                <p>
                  Compared GOOD_MATCH labels: {campaign.positiveMatchDiagnostics.compared} of{" "}
                  {campaign.positiveMatchDiagnostics.recorded}; correctly identified:{" "}
                  {campaign.positiveMatchDiagnostics.agreements}; missed:{" "}
                  {campaign.positiveMatchDiagnostics.missed}; incomplete:{" "}
                  {campaign.positiveMatchDiagnostics.incomplete}. Measurement:{" "}
                  {campaign.positiveMatchDiagnostics.measurement}.
                </p>
                <p>
                  Among missed positives: not eligible{" "}
                  {campaign.positiveMatchDiagnostics.eligibilityNotEligible}; not recommended{" "}
                  {campaign.positiveMatchDiagnostics.notRecommended}; outside review bands{" "}
                  {campaign.positiveMatchDiagnostics.notInReviewBand}. Reasons can overlap and must
                  not be added together as distinct misses.
                </p>
                <p>
                  Positive-match performance needs separate review. A class with zero compared
                  labels is unmeasured, not a measured zero-percent result. Even strong overall
                  label agreement does not prove that useful jobs are being found. These diagnostics
                  do not change any qualification decision or provide application consent.
                </p>
                <p>
                  Pair sample: {campaign.assessment.pairDiagnostics.sample}. Observed pair
                  performance: {campaign.assessment.pairDiagnostics.performance}.
                </p>
                <p>
                  Strict agreements {campaign.assessment.pairDiagnostics.agrees}; ties{" "}
                  {campaign.assessment.pairDiagnostics.ties}; opposite rankings{" "}
                  {campaign.assessment.pairDiagnostics.opposite}; incomplete{" "}
                  {campaign.assessment.pairDiagnostics.incomplete}. Required comparisons:{" "}
                  {campaign.assessment.pairDiagnostics.requiredComparisons ?? "thresholds missing"};
                  required agreements at observed sample:{" "}
                  {campaign.assessment.pairDiagnostics.requiredAgreementsAtObservedSample ??
                    "no measured sample"}
                  ; at minimum sample:{" "}
                  {campaign.assessment.pairDiagnostics.requiredAgreementsAtMinimumSample ??
                    "thresholds missing"}
                  .
                </p>
                <p>
                  Sample sufficiency and measured performance are separate. Ties count as
                  disagreements. NO_SAMPLE means there is no complete measured pair, not a measured
                  zero-percent result. More pairs alone do not repair poor agreement. Qualification
                  also requires every provenance, safety and separate owner approval gate.
                </p>
                <ul>
                  {campaign.assessment.blockerCodes.map((code) => (
                    <li key={code}>
                      <code>{code}</code>
                    </li>
                  ))}
                </ul>
                <h3>Executable safety evidence</h3>
                <ul>
                  {campaign.safetyProofs.map((p) => (
                    <li key={p.gate}>
                      {p.gate}: {p.status}
                    </li>
                  ))}
                </ul>
                <p>
                  Safety bundle: <code>{campaign.safetyBundleDigest ?? "NOT_CURRENT"}</code>.
                  Private corpus: <code>{campaign.corpusVersion}</code>.
                </p>
                <details>
                  <summary>Final-version comparison outcomes (retained corpus only)</summary>
                  <ul>
                    {campaign.members.map((m) => (
                      <li key={m.id}>
                        {m.title}: {m.eligibility}; score {m.score}; recommended{" "}
                        {String(m.recommended)}; coverage {m.coveragePercent}%.
                      </li>
                    ))}
                  </ul>
                </details>
                {view.currentQualificationCampaignId === campaign.id ? (
                  <p>This exact campaign has a current owner-approved qualification.</p>
                ) : campaign.readyForOwnerApproval ? (
                  <form action={approveCalibrationQualificationAction}>
                    <Hidden name="campaignId" value={campaign.id} />
                    <Hidden name="assessmentDigest" value={campaign.assessmentDigest} />
                    <Hidden
                      name="mutationNonce"
                      value={await issueLocalMutationNonce(
                        r2CalibrationOwnerAction("QUAL", {
                          campaignId: campaign.id,
                          assessmentDigest: campaign.assessmentDigest,
                        }),
                        "/calibration",
                      )}
                    />
                    <p>
                      This separate approval binds the displayed assessment, genuine events,
                      precommitted thresholds and all eight current safety proofs. It grants no
                      application permission.
                    </p>
                    <button type="submit" name="approvalChoice" value="APPROVE">
                      Approve this matching qualification
                    </button>
                  </form>
                ) : (
                  <p>
                    Qualification approval is unavailable until the actual evidence satisfies every
                    other blocker.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
