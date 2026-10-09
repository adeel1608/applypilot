import {
  hostedCapabilityDigest,
  hostedDigest,
  hostedOwnerAction,
  nonFactualConsentKind,
  hostedAllowedFactPaths,
} from "@applypilot/application-runner";
import {
  getHostedWorkspaceView,
  hostedPrivatePreview,
  hostedQuestionReviewView,
} from "@web/lib/hosted-workspace";
import { issueLocalMutationNonce, requireLocalSession } from "@web/lib/local-mutation-security";
import {
  hostedOwnerActionForm,
  hostedPacketReviewAction,
  hostedStopAction,
} from "./hosted-actions";

export async function HostedApplicationPanel() {
  await requireLocalSession("/applications");
  const view = getHostedWorkspaceView();
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Supervised hosted applications</span>
          <h2>Review each application step</h2>
        </div>
        <span className="source-pill">{view.state.replaceAll("_", " ")}</span>
      </div>
      <p>
        Passive inspection sends no candidate values or documents. Filling and uploading require
        separate approval. Submission requires a fresh final confirmation.
      </p>
      {view.state !== "AVAILABLE" && (
        <p>Browser actions are blocked until the reviewed local update is installed.</p>
      )}
      {!view.capabilities.length && (
        <p>
          No exact hosted target is staged. Choose a current supported job for passive inspection,
          then resolve its packet requirements.
        </p>
      )}
      {await Promise.all(
        view.capabilities.map(async (cap) => {
          const digest = hostedCapabilityDigest(cap);
          const session = view.sessions.find(
            (value) => value.capability.capabilityId === cap.capabilityId,
          );
          const executable = view.executableDigests.includes(digest);
          const kind =
            cap.scope === "PASSIVE_INSPECTION" && !session
              ? "INSPECT"
              : cap.scope === "APPLICATION" && session?.state === "INSPECTED"
                ? "DISCLOSE"
                : session?.state === "REVIEW_READY"
                  ? "SUBMIT"
                  : null;
          const sessionId = kind === "INSPECT" ? "" : (session?.id ?? "");
          const action = kind
            ? hostedOwnerAction(
                kind,
                cap,
                sessionId,
                kind === "SUBMIT" ? hostedDigest(session?.preview) : "",
              )
            : "";
          const nonce =
            kind && executable ? await issueLocalMutationNonce(action, "/applications") : null;
          const phrase =
            kind === "INSPECT"
              ? `INSPECT ${cap.capabilityId}`
              : kind === "DISCLOSE"
                ? `DISCLOSE AND PREPARE ${cap.capabilityId}`
                : `SUBMIT ${sessionId}`;
          const preview = session && hostedPrivatePreview(session, cap);
          let review: ReturnType<typeof hostedQuestionReviewView> = null;
          if (session?.state === "INSPECTED") {
            try {
              review = hostedQuestionReviewView(session.id);
            } catch {
              review = null;
            }
          }
          const questionNonce = review?.session.discovery
            ? await issueLocalMutationNonce(
                `HOSTED_QUESTION_REVIEW:${hostedDigest(cap.subject)}:${hostedDigest(review.session.discovery)}`,
                "/applications",
              )
            : null;
          const stopNonce =
            session &&
            ["INSPECTED", "MAPPED", "FILLED", "UPLOADED", "VERIFIED", "REVIEW_READY"].includes(
              session.state,
            )
              ? await issueLocalMutationNonce(`HOSTED_STOP:${session.id}`, "/applications")
              : null;
          return (
            <article key={`${cap.capabilityId}:${cap.version}`}>
              <h3>
                {cap.subject.provider} · {cap.subject.tenant} · post {cap.subject.externalId}
              </h3>
              <p>
                <a href={cap.subject.targetUrl} target="_blank" rel="noreferrer">
                  Exact application destination
                </a>
              </p>
              <p>
                Capability {cap.capabilityId} · version {cap.version} · digest <code>{digest}</code>
              </p>
              <p>
                Read budget {cap.requestBudget} · response limit {cap.responseByteLimit} bytes ·
                expires {cap.expiresAt}
              </p>
              {cap.allowedWrites.length > 0 && (
                <p>
                  Approved POST destinations:{" "}
                  {cap.allowedWrites
                    .map((value) => `${value.operation} ${value.origin}${value.path}`)
                    .join("; ")}
                </p>
              )}
              {session && (
                <p>
                  State {session.state} · {session.requestCount} requests ·{" "}
                  {session.safeStopCode ?? "no recorded stop"}. Review-ready is inactive and
                  preserves the same owned browser until expiry or owner stop.
                </p>
              )}
              {review?.session.discovery && questionNonce && (
                <form action={hostedPacketReviewAction} className="import-form">
                  <h4>Review discovered questions and alternatives</h4>
                  <input type="hidden" name="mutationNonce" value={questionNonce} />
                  <input type="hidden" name="sessionId" value={review.session.id} />
                  {review.session.discovery.safeBlockers.map((code) => (
                    <p key={code}>{code}</p>
                  ))}
                  {review.session.discovery.groups.map((group, index) => (
                    <label key={group.id}>
                      Question group {group.id}
                      {group.required ? " (required)" : " (optional)"}
                      <select name={`alternative:${index}`} defaultValue="">
                        <option value="">Leave unresolved / unanswered</option>
                        {group.alternatives.map((alternative, alternativeIndex) => (
                          <option key={alternativeIndex} value={alternativeIndex}>
                            {alternative.kind === "DOCUMENT"
                              ? `Approved current ${alternative.documentType}`
                              : (review!.session.discovery!.questions.find(
                                  (question) => question.id === alternative.questionId,
                                )?.label ?? alternative.questionId)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {review.session.discovery.questions.map((question, index) => (
                    <label key={question.id}>
                      {question.label}
                      {question.required ? " (required)" : ""}
                      {nonFactualConsentKind(question) ? (
                        <select name={`choice:${index}`} defaultValue="">
                          <option value="">No choice recorded</option>
                          <option value="true">I choose to agree</option>
                          <option value="false">I choose to decline</option>
                        </select>
                      ) : (
                        <select name={`fact:${index}`} defaultValue="">
                          <option value="">Unknown / unsupported / leave unanswered</option>
                          {review!.facts
                            .filter((fact) => hostedAllowedFactPaths(question).includes(fact.path))
                            .map((fact) => (
                              <option key={fact.path} value={fact.path}>
                                {fact.path}: {String(fact.value)}
                              </option>
                            ))}
                        </select>
                      )}
                    </label>
                  ))}
                  <label>
                    <input type="checkbox" name="ownerConfirmed" value="yes" required />I reviewed
                    these exact answers, choices and document alternatives. Selected verified facts
                    may be disclosed during a separately approved application step.
                  </label>
                  <button
                    className="button button--primary"
                    disabled={!review.session.discovery.complete}
                  >
                    Prepare reviewed packet locally
                  </button>
                </form>
              )}
              {preview && (
                <div>
                  <h4>Exact packet preview</h4>
                  <ul>
                    {preview.answers.map((answer) => (
                      <li key={answer.questionId}>
                        {answer.questionText}: {String(answer.value)} ·{" "}
                        {answer.truthState === "OWNER_CHOICE" ? "owner choice" : "verified fact"}
                      </li>
                    ))}
                    {preview.documents.map((document) => (
                      <li key={document.id}>
                        {document.fileName} · {document.digest}
                      </li>
                    ))}
                  </ul>
                  <p>Unanswered: {preview.unanswered.join("; ") || "none"}</p>
                  <p>
                    Document proof:{" "}
                    {session!.proofs
                      .map((proof) => `${proof.documentId}: ${proof.proof}`)
                      .join("; ") || "none"}
                  </p>
                </div>
              )}
              {session?.preview && (
                <p>
                  Final preview digest <code>{hostedDigest(session.preview)}</code> · material
                  differences {session.preview.materialDiffCount}. No submit activation has occurred
                  while state is REVIEW_READY.
                </p>
              )}
              {kind && nonce && (
                <form action={hostedOwnerActionForm} className="import-form">
                  <input type="hidden" name="mutationNonce" value={nonce} />
                  <input type="hidden" name="capabilityId" value={cap.capabilityId} />
                  <input type="hidden" name="version" value={cap.version} />
                  <input type="hidden" name="digest" value={digest} />
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="sessionId" value={sessionId} />
                  {kind === "DISCLOSE" && <p>{view.disclosure}</p>}
                  {kind === "SUBMIT" && (
                    <p>
                      This activates submit once for the exact preview. An uncertain response is
                      never automatically resent.
                    </p>
                  )}
                  <label>
                    <input type="checkbox" name="ownerConfirmed" value="yes" required />
                    {kind === "INSPECT"
                      ? "I approve this exact passive inspection."
                      : kind === "DISCLOSE"
                        ? "I approve disclosure of this packet to these destinations during fill and upload."
                        : "I approve this exact final application submission once."}
                  </label>
                  <label>
                    Type {phrase}
                    <input name="confirmationText" required autoComplete="off" />
                  </label>
                  <button className="button button--primary">
                    {kind === "INSPECT"
                      ? "Inspect exact form"
                      : kind === "DISCLOSE"
                        ? "Fill, upload and verify"
                        : "Submit reviewed application once"}
                  </button>
                </form>
              )}
              {stopNonce && (
                <form action={hostedStopAction}>
                  <input type="hidden" name="mutationNonce" value={stopNonce} />
                  <input type="hidden" name="sessionId" value={session!.id} />
                  <label>
                    <input type="checkbox" name="ownerConfirmed" value="yes" required />
                    Close this owned browser and revoke its authority.
                  </label>
                  <button className="button">Stop this session</button>
                </form>
              )}
            </article>
          );
        }),
      )}
    </section>
  );
}
