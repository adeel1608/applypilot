import { notFound, redirect } from "next/navigation";

const fixtureCases = [
  "normal",
  "unknown-required",
  "documents",
  "eligibility",
  "captcha",
  "mfa",
  "auth",
  "bot",
  "rate",
  "access",
  "restriction",
  "unsupported",
  "changed-form",
  "changed-destination",
  "popup",
  "hidden-step",
  "hidden-submit",
  "file-chooser",
] as const;

type FixtureCase = (typeof fixtureCases)[number];

function fixtureCase(value: string | undefined): FixtureCase {
  return fixtureCases.includes(value as FixtureCase) ? (value as FixtureCase) : "normal";
}

const stopSignals: Partial<Record<FixtureCase, string>> = {
  captcha: "CAPTCHA",
  mfa: "MFA",
  auth: "AUTHENTICATION_REQUIRED",
  bot: "BOT_DETECTION",
  rate: "RATE_LIMIT",
  access: "ACCESS_CONTROL",
  restriction: "WEBSITE_RESTRICTION",
};

export const dynamic = "force-dynamic";

export default async function SyntheticInspectionPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  if (process.env.APPLYPILOT_SYNTHETIC_MODE !== "1") notFound();
  const fixture = fixtureCase((await searchParams).case);
  if (fixture === "changed-destination") redirect("/synthetic-application");
  const formVersion =
    fixture === "changed-form"
      ? "lever-application-inspection-v2"
      : "lever-application-inspection-v1";
  const signal = stopSignals[fixture];
  return (
    <main
      className="page-stack"
      data-synthetic-inspection={fixture}
      data-form-version={formVersion}
    >
      <section className="page-heading">
        <div className="eyebrow">Fictional read-only Lever inspection fixture</div>
        <h1>Example Robotics application</h1>
        <p>No employer, candidate, upload, or submission system is connected.</p>
      </section>
      {signal ? <div data-stop-reason={signal}>Synthetic protection stop</div> : null}
      {fixture === "popup" ? (
        <a href="https://outside.example.test/fictional" target="_blank" rel="noreferrer">
          Fictional popup step
        </a>
      ) : null}
      {fixture === "hidden-step" ? (
        <div data-hidden-application-step>Fictional hidden interactive step</div>
      ) : null}
      <form method="get">
        <label>
          First name
          <input name="firstName" autoComplete="given-name" required />
        </label>
        <label>
          Last name
          <input name="lastName" autoComplete="family-name" required />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        {fixture === "unknown-required" ? (
          <label>
            Fictional unknown required field
            <input name="unknownRequired" required />
          </label>
        ) : null}
        {["documents", "file-chooser"].includes(fixture) ? (
          <label>
            Resume
            <input name="resume" type="file" required />
          </label>
        ) : null}
        {fixture === "documents" ? (
          <label>
            Cover letter
            <input name="coverLetter" type="file" />
          </label>
        ) : null}
        {fixture === "eligibility" ? (
          <fieldset>
            <legend>Fictional eligibility questions</legend>
            <label>
              Are you authorized to work in this location?
              <select name="workAuthorization" required defaultValue="">
                <option value="" disabled>
                  Select
                </option>
                <option value="fictional-yes">Yes</option>
                <option value="fictional-no">No</option>
              </select>
            </label>
            <label>
              Will you require sponsorship?
              <select name="sponsorship" required defaultValue="">
                <option value="" disabled>
                  Select
                </option>
                <option value="fictional-yes">Yes</option>
                <option value="fictional-no">No</option>
              </select>
            </label>
            <label>
              Citizenship
              <input name="citizenship" required />
            </label>
            <label>
              Export control status
              <input name="exportControl" required />
            </label>
            <label>
              Security clearance
              <input name="securityClearance" required />
            </label>
          </fieldset>
        ) : null}
        {fixture === "unsupported" ? (
          <div role="combobox-custom" data-unsupported-control>
            <label>
              Fictional custom widget
              <input name="customWidget" required data-unsupported-control />
            </label>
          </div>
        ) : null}
        <button type="submit" hidden={fixture === "hidden-submit"}>
          Submit fictional application
        </button>
      </form>
    </main>
  );
}
