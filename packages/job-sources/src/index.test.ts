import { describe, expect, it } from "vitest";

import { AdapterCapability, jobSourceAdapters, SeekAdapterError } from "./index";

describe("job source adapter placeholders", () => {
  it("keeps LinkedIn manual/assisted in the foundation", () => {
    expect(jobSourceAdapters.linkedin.capabilities()).toContain(AdapterCapability.MANUAL_ONLY);
    expect(jobSourceAdapters.linkedin.capabilities()).not.toContain(AdapterCapability.FORM_FILLING);
  });

  it("uses a network-free SEEK implementation with no implicit fixture data", async () => {
    await expect(
      jobSourceAdapters.seek.discoverJobs({ keywords: ["assistant"], locations: ["Melbourne"] }),
    ).resolves.toEqual({ records: [], nextCursor: undefined });
    await expect(jobSourceAdapters.seek.fetchJob("unknown")).rejects.toBeInstanceOf(
      SeekAdapterError,
    );
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
