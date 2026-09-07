import { notFound } from "next/navigation";

const fixtureCases = [
  "simple",
  "required-unknown",
  "conditional",
  "document-upload",
  "changed-page",
  "redirect",
  "captcha",
  "mfa",
  "access-denied",
  "rate-limit",
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
        <button type="submit">Submit fictional fixture</button>
      </form>
    </main>
  );
}
