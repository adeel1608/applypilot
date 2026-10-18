import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  r2CalibrationOwnerAction,
  r2CalibrationCreateBinding,
  r2CalibrationLabelBinding,
  r2CalibrationPairBinding,
} from "@applypilot/fit-scorer";

const state = vi.hoisted(() => ({
  session: "",
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  create: vi.fn(),
  label: vi.fn(),
  pair: vi.fn(),
  qualify: vi.fn(),
  revalidate: vi.fn(),
}));
const clock = vi.hoisted(() => {
  const value = { now: Date.UTC(2026, 9, 18) };
  // The unchanged real token store captures Date.now during module initialization.
  const spy = vi.spyOn(Date, "now").mockImplementation(() => value.now);
  return { value, spy };
});
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host, origin: state.origin }),
  cookies: async () => ({ get: () => (state.session ? { value: state.session } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (value: string) => {
    throw new Error(`REDIRECT:${value}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@web/lib/calibration-workspace", () => ({
  createCalibrationCampaign: state.create,
  recordCalibrationLabel: state.label,
  recordCalibrationPair: state.pair,
  approveCalibrationQualification: state.qualify,
}));
import { localMutationTokens, issueLocalMutationNonce } from "@web/lib/local-mutation-security";
import {
  createCalibrationCampaignAction,
  recordCalibrationLabelAction,
  recordCalibrationPairAction,
  approveCalibrationQualificationAction,
} from "./actions";

const contextDigest = "a".repeat(64);
const creation = {
  jobIds: ["job-1", "job-2"],
  expectedContextDigest: contextDigest,
  thresholds: {
    version: "owner-policy-1",
    minimumLabelAgreementBasisPoints: 8000,
    minimumPairComparisons: 1,
    minimumPairAgreementBasisPoints: 9000,
  },
};
const label = {
  campaignId: "fictional-campaign",
  comparisonId: "comparison-1",
  expectedContextDigest: contextDigest,
  previousEventId: null,
  label: "AMBIGUOUS",
  occupationalFamily: "ADMINISTRATION_OFFICE",
};
const pair = {
  campaignId: "fictional-campaign",
  leftComparisonId: "comparison-1",
  rightComparisonId: "comparison-2",
  preferredComparisonId: "comparison-2",
  expectedContextDigest: contextDigest,
  previousEventId: null,
};
const qualification = { campaignId: "fictional-campaign", assessmentDigest: "b".repeat(64) };
const cases = [
  {
    purpose: "CREATE" as const,
    binding: r2CalibrationCreateBinding(creation),
    action: createCalibrationCampaignAction,
    mock: state.create,
    expected: creation,
    fields: {
      jobId: creation.jobIds,
      expectedContextDigest: contextDigest,
      thresholdVersion: creation.thresholds.version,
      minimumLabelAgreementBasisPoints: "8000",
      minimumPairComparisons: "1",
      minimumPairAgreementBasisPoints: "9000",
    },
  },
  {
    purpose: "LABEL" as const,
    binding: r2CalibrationLabelBinding(label),
    action: recordCalibrationLabelAction,
    mock: state.label,
    expected: label,
    fields: { ...label, previousEventId: "" },
  },
  {
    purpose: "PAIR" as const,
    binding: r2CalibrationPairBinding(pair),
    action: recordCalibrationPairAction,
    mock: state.pair,
    expected: pair,
    fields: { ...pair, previousEventId: "" },
  },
  {
    purpose: "QUAL" as const,
    binding: qualification,
    action: approveCalibrationQualificationAction,
    mock: state.qualify,
    expected: qualification,
    fields: { ...qualification, approvalChoice: "APPROVE" },
  },
];

async function form(test: (typeof cases)[number]): Promise<FormData> {
  const data = new FormData();
  for (const [key, value] of Object.entries(test.fields))
    for (const row of Array.isArray(value) ? value : [value]) data.append(key, String(row));
  data.set(
    "mutationNonce",
    await issueLocalMutationNonce(
      r2CalibrationOwnerAction(test.purpose, test.binding),
      "/calibration",
    ),
  );
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  clock.value.now = Date.UTC(2026, 9, 18);
  state.host = "127.0.0.1:3000";
  state.origin = "http://127.0.0.1:3000";
  state.session = localMutationTokens.createSession().token;
  state.create.mockResolvedValue("fictional-campaign");
  state.label.mockResolvedValue("fictional-label");
  state.pair.mockResolvedValue("fictional-pair");
  state.qualify.mockResolvedValue("fictional-run");
});
afterAll(() => clock.spy.mockRestore());

describe("calibration actions use the real one-use local nonce store", () => {
  it.each(cases)(
    "$purpose consumes the exact binding once and derives actual server proof",
    async (test) => {
      const data = await form(test);
      await expect(test.action(data)).rejects.toThrow(
        "REDIRECT:/calibration?campaign=fictional-campaign",
      );
      expect(test.mock).toHaveBeenCalledExactlyOnceWith(
        test.expected,
        expect.objectContaining({
          action: r2CalibrationOwnerAction(test.purpose, test.binding),
          loopbackValidated: true,
          localSessionValidated: true,
          nonceConsumed: true,
        }),
      );
      expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/calibration");
      await expect(test.action(data)).rejects.toThrow("REDIRECT:/calibration?notice=rejected");
      expect(test.mock).toHaveBeenCalledTimes(1);
    },
  );
  it.each(cases)(
    "$purpose rejects wrong context while leaving the original nonce usable",
    async (test) => {
      const data = await form(test),
        field = test.purpose === "QUAL" ? "assessmentDigest" : "expectedContextDigest";
      const original = data.get(field)!;
      data.set(field, "c".repeat(64));
      await expect(test.action(data)).rejects.toThrow("REDIRECT:/calibration?notice=rejected");
      expect(test.mock).not.toHaveBeenCalled();
      data.set(field, original);
      await expect(test.action(data)).rejects.toThrow(
        "REDIRECT:/calibration?campaign=fictional-campaign",
      );
      expect(test.mock).toHaveBeenCalledTimes(1);
    },
  );
  it.each(cases)(
    "$purpose never dispatches local writes on origin/session/duplicate/expiry rejection",
    async (test) => {
      const data = await form(test);
      state.origin = "https://foreign.invalid";
      await expect(test.action(data)).rejects.toThrow("REDIRECT:/calibration?notice=rejected");
      state.origin = "http://127.0.0.1:3000";
      const originalSession = state.session;
      state.session = localMutationTokens.createSession().token;
      await expect(test.action(data)).rejects.toThrow("REDIRECT:/calibration?notice=rejected");
      state.session = originalSession;
      data.append("mutationNonce", String(data.get("mutationNonce")));
      await expect(test.action(data)).rejects.toThrow("REDIRECT:/calibration?notice=rejected");
      const clean = await form(test);
      clock.value.now += 16 * 60_000;
      await expect(test.action(clean)).rejects.toThrow("REDIRECT:/calibration?notice=expired");
      expect(test.mock).not.toHaveBeenCalled();
    },
  );
  it("rejects blank decisions, unknown fields and duplicate scalars without writing owner judgments", async () => {
    for (const test of cases) {
      const data = await form(test);
      data.append("actor", "OWNER");
      await expect(test.action(data)).rejects.toThrow("notice=rejected");
      expect(test.mock).not.toHaveBeenCalled();
    }
    const data = await form(cases[1]!);
    data.set("label", "");
    await expect(recordCalibrationLabelAction(data)).rejects.toThrow("notice=rejected");
    data.set("label", "GOOD_MATCH");
    data.append("comparisonId", "comparison-1");
    await expect(recordCalibrationLabelAction(data)).rejects.toThrow("notice=rejected");
    expect(state.label).not.toHaveBeenCalled();
    const qualified = await form(cases[3]!);
    qualified.delete("approvalChoice");
    await expect(approveCalibrationQualificationAction(qualified)).rejects.toThrow(
      "notice=rejected",
    );
    expect(state.qualify).not.toHaveBeenCalled();
  });
  it("does not leak a private downstream exception or turn it into approval", async () => {
    state.qualify.mockRejectedValue(new Error("PRIVATE_CANDIDATE_CANARY fictional-secret"));
    await expect(approveCalibrationQualificationAction(await form(cases[3]!))).rejects.toThrow(
      "REDIRECT:/calibration?notice=rejected",
    );
    expect(state.revalidate).not.toHaveBeenCalled();
  });
  it.each(cases)("$purpose cannot accept a posted redirect destination", async (test) => {
    const data = await form(test);
    data.set("returnTo", "https://foreign.invalid/redirect-canary");
    await expect(test.action(data)).rejects.toThrow("REDIRECT:/calibration?notice=rejected");
    expect(test.mock).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });
  it("keeps a returned campaign identifier encoded within the fixed local query destination", async () => {
    // A deliberately malformed trusted-boundary fixture verifies the existing URL encoding;
    // the real repository separately validates generated campaign identifiers.
    const identifier = "//foreign.invalid/path?next=/sources#redirect-canary";
    state.create.mockResolvedValue(identifier);
    await expect(createCalibrationCampaignAction(await form(cases[0]!))).rejects.toThrow(
      `REDIRECT:/calibration?campaign=${encodeURIComponent(identifier)}`,
    );
    expect(state.create).toHaveBeenCalledOnce();
    expect(state.revalidate).toHaveBeenCalledExactlyOnceWith("/calibration");
  });
});
