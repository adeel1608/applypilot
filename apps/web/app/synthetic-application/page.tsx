import { notFound } from "next/navigation";

const fixtureCases = [
  "simple",
  "required-unknown",
  "conditional",
  "document-upload",
  "changed-page",
  "changed-field",
  "redirect",
  "captcha",
  "mfa",
  "auth-required",
  "http-401",
  "http-403",
  "http-429",
  "access-denied",
  "rate-limit",
  "unsupported-control",
  "slow-response",
  "success-receipt",
  "different-action",
  "lost-response",
] as const;
type FixtureCase = (typeof fixtureCases)[number];

function isFixtureCase(value: string | undefined): value is FixtureCase {
  return fixtureCases.includes(value as FixtureCase);
}

export const dynamic = "force-dynamic";

export default async function SyntheticApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  if (process.env.APPLYPILOT_SYNTHETIC_MODE !== "1") notFound();
  const requested = (await searchParams).case;
  const fixture: FixtureCase = isFixtureCase(requested) ? requested : "simple";
  const formVersion = fixture === "changed-page" ? "synthetic-form-v2" : "synthetic-form-v1";
  const action = `/synthetic-application/submit?case=${fixture}`;
  return (
    <main className="page-stack" data-synthetic-fixture={fixture} data-form-version={formVersion}>
      <section className="page-heading">
        <div className="eyebrow">Synthetic local fixture only</div>
        <h1>Fictional application form</h1>
        <p>This test surface never connects to an employer or external application system.</p>
      </section>
      {fixture === "captcha" ? (
        <div role="alert" data-stop-reason="CAPTCHA">
          CAPTCHA marker
        </div>
      ) : null}
      {fixture === "mfa" ? (
        <div role="alert" data-stop-reason="MFA">
          MFA marker
        </div>
      ) : null}
      {fixture === "auth-required" ? (
        <div role="alert" data-stop-reason="AUTHENTICATION_REQUIRED">
          Authentication required marker
        </div>
      ) : null}
      {fixture === "access-denied" ? (
        <div role="alert" data-stop-reason="ACCESS_CONTROL">
          Access denied marker
        </div>
      ) : null}
      {fixture === "rate-limit" ? (
        <div role="alert" data-stop-reason="RATE_LIMIT">
          Rate limit marker
        </div>
      ) : null}
      <form
        action={action}
        method="post"
        encType="multipart/form-data"
        data-expected-action={
          fixture === "different-action" ? "/synthetic-application/unexpected" : action
        }
      >
        <input type="hidden" name="formVersion" value={formVersion} />
        <label>
          Fictional applicant name
          <input name="applicantName" autoComplete="off" required />
        </label>
        <label>
          Fictional contact email
          <input name="contactEmail" type="email" autoComplete="off" required />
        </label>
        {fixture === "changed-field" ? (
          <label>
            Newly introduced required field
            <input name="newRequiredField" required data-form-change="FIELD_ADDED" />
          </label>
        ) : null}
        {fixture === "required-unknown" ? (
          <label>
            Unsupported required answer
            <input name="unsupportedRequiredAnswer" required data-answer-state="UNKNOWN" />
          </label>
        ) : null}
        {fixture === "conditional" ? (
          <fieldset>
            <legend>Conditional fictional question</legend>
            <label>
              <input type="checkbox" name="conditionApplies" /> Condition applies
            </label>
            <label>
              Conditional detail <input name="conditionalDetail" />
            </label>
          </fieldset>
        ) : null}
        {fixture === "document-upload" ? (
          <label>
            Approved synthetic document <input type="file" name="document" required />
          </label>
        ) : null}
        {fixture === "unsupported-control" ? (
          <label>
            Unsupported fictional control
            <input type="color" name="unsupportedControl" required data-unsupported-control />
          </label>
        ) : null}
        <button type="submit">Submit fictional fixture</button>
      </form>
      {fixture === "document-upload" ? (
        <section className="panel" data-final-review="fictional-frozen-packet">
          <span className="section-kicker">Frozen synthetic final review</span>
          <h2>Exact approved fixture mapping</h2>
          <dl className="fact-list">
            <div>
              <dt>Applicant name</dt>
              <dd>Approved fictional answer</dd>
            </div>
            <div>
              <dt>Contact email</dt>
              <dd>Approved fictional answer</dd>
            </div>
            <div>
              <dt>Document</dt>
              <dd>Approved synthetic digest required</dd>
            </div>
            <div>
              <dt>Unresolved required fields</dt>
              <dd>0</dd>
            </div>
          </dl>
          <p>A changed packet, form, destination, document or consent causes zero final clicks.</p>
        </section>
      ) : null}
    </main>
  );
}
