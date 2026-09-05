import { describe, expect, it } from "vitest";

import { AdapterCapability, AdapterNotImplementedError, jobSourceAdapters } from "./index";

describe("job source adapter placeholders", () => {
  it("keeps LinkedIn manual/assisted in the foundation", () => {
    expect(jobSourceAdapters.linkedin.capabilities()).toContain(AdapterCapability.MANUAL_ONLY);
    expect(jobSourceAdapters.linkedin.capabilities()).not.toContain(AdapterCapability.FORM_FILLING);
  });

  it("fails explicitly instead of performing live discovery", async () => {
    await expect(
      jobSourceAdapters.seek.discoverJobs({ keywords: ["assistant"], locations: ["Melbourne"] }),
    ).rejects.toBeInstanceOf(AdapterNotImplementedError);
  });

  it("exports every planned placeholder", () => {
    expect(Object.keys(jobSourceAdapters)).toEqual([
      "seek",
      "indeed",
      "linkedin",
      "employmentHero",
      "workday",
      "greenhouse",
      "lever",
      "genericCompanySite",
    ]);
  });
});
