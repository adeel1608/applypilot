import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { R2_CALIBRATION_SAFETY_GATES } from "@applypilot/fit-scorer";
import type { CalibrationView, CalibrationMemberView } from "@web/lib/calibration-workspace";

const state = vi.hoisted(() => ({
  session: "",
  view: vi.fn(),
  create: vi.fn(),
  label: vi.fn(),
  pair: vi.fn(),
  qualify: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }),
  cookies: async () => ({ get: () => (state.session ? { value: state.session } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (value: string) => {
    throw new Error(`REDIRECT:${value}`);
  },
}));
vi.mock("@web/lib/calibration-workspace", () => ({ getCalibrationView: state.view }));
vi.mock("./actions", () => ({
  createCalibrationCampaignAction: state.create,
  recordCalibrationLabelAction: state.label,
  recordCalibrationPairAction: state.pair,
  approveCalibrationQualificationAction: state.qualify,
}));
import { localMutationTokens } from "@web/lib/local-mutation-security";
import CalibrationPage from "./page";

function member(id: string): CalibrationMemberView {
  return {
    id,
    jobId: `job-${id}`,
    jobVersionId: `version-${id}`,
    sourceObservationId: `observation-${id}`,
    title: `Fictional duties ${id}`,
    company: "Fictional Company",
    location: "Melbourne VIC",
    description: "<script>source-canary</script><img src='https://foreign.invalid/tracker'>",
    sourceUrl: "https://jobs.lever.co/fictional/post",
    source: "LEVER",
    region: "GLOBAL",
    tenant: "fictional",
    externalId: id,
    observedAt: "2026-10-01T00:00:00.000Z",
    verifiedAt: "2026-10-01T00:00:00.000Z",
    parserVersion: "3.6.5",
    normalizationVersion: "3.6.5",
    unresolvedDirectDuplicateCount: 2,
    eligibility: "REVIEW_REQUIRED",
    score: 0,
    recommended: false,
    coveragePercent: 50,
  };
}
function view(): CalibrationView {
  return {
    status: "READY",
    safeCode: null,
    currentQualificationRunId: null,
    currentQualificationCampaignId: null,
    verifiedContext: [{ reference: "skills:fictional", summary: "Verified fictional skill" }],
    candidates: [],
    campaigns: [],
    selection: null,
    campaign: {
      id: "campaign-1",
      contextDigest: "a".repeat(64),
      memberDigest: "b".repeat(64),
      corpusVersion: "r2-private-fixture",
      thresholds: {
        version: "owner-policy-1",
        minimumLabelAgreementBasisPoints: 8000,
        minimumPairComparisons: 5,
        minimumPairAgreementBasisPoints: 8000,
      },
      members: [member("comparison-1"), member("comparison-2")],
      labels: [
        {
          id: "label-1",
          comparisonId: "comparison-1",
          revision: 1,
          label: "AMBIGUOUS",
          occupationalFamily: "UNKNOWN",
        },
      ],
      pairs: [],
      assessment: {
        state: "UNCALIBRATED",
        sourceLabelCount: 1,
        comparedLabelCount: 0,
        sourcePairCount: 0,
        comparedPairCount: 0,
        roleFamilyCount: 0,
        statusCount: 0,
        labelAgreementBasisPoints: 0,
        pairAgreementBasisPoints: 0,
        blockerCodes: ["PRIVATE_ROLE_FAMILY_COVERAGE_INCOMPLETE"],
      },
      assessmentDigest: "c".repeat(64),
      readyForOwnerApproval: false,
      safetyStatus: "NOT_CURRENT",
      safetyBundleDigest: null,
      safetyProofs: R2_CALIBRATION_SAFETY_GATES.map((gate) => ({ gate, status: "MISSING" })),
    },
  };
}
function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const e = node as ReactElement<Record<string, unknown>>;
  if (typeof e.type === "function")
    return [e, ...elements((e.type as (props: Record<string, unknown>) => ReactNode)(e.props))];
  return [e, ...elements(e.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (!isValidElement<{ children?: ReactNode }>(node)) return "";
  return text(node.props.children);
}
const page = (query: Record<string, string | string[] | undefined> = {}) =>
  CalibrationPage({ searchParams: Promise.resolve(query) });

beforeEach(() => {
  vi.clearAllMocks();
  state.session = localMutationTokens.createSession().token;
  state.view.mockResolvedValue(view());
});

describe("local calibration owner context and blank controls", () => {
  it("requires the actual local session before reading private context", async () => {
    state.session = "";
    await expect(page()).rejects.toThrow("REDIRECT:/local-session?returnTo=%2Fcalibration");
    expect(state.view).not.toHaveBeenCalled();
  });
  it("renders explicit pending evidence and never prefills historical labels or occupational families", async () => {
    const tree = await page({ campaign: "campaign-1" }),
      all = elements(tree);
    const labelForms = all.filter((e) => e.type === "form" && e.props.action === state.label);
    expect(labelForms).toHaveLength(2);
    for (const form of labelForms)
      for (const select of elements(form).filter((e) => e.type === "select")) {
        expect(select.props.defaultValue).toBe("");
        expect(select.props.value).toBeUndefined();
      }
    expect(all.filter((e) => e.props.action === state.qualify)).toHaveLength(0);
    expect(text(tree)).toContain("UNKNOWN");
    for (const gate of R2_CALIBRATION_SAFETY_GATES) expect(text(tree)).toContain(gate);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.label).not.toHaveBeenCalled();
  });
  it("shows exact pair context and leaves both preference radios unchecked", async () => {
    const tree = await page({
      campaign: "campaign-1",
      left: "comparison-1",
      right: "comparison-2",
    });
    const form = elements(tree).find((e) => e.type === "form" && e.props.action === state.pair);
    expect(form).toBeDefined();
    const inputs = elements(form).filter((e) => e.type === "input");
    expect(inputs.find((e) => e.props.name === "leftComparisonId")?.props.value).toBe(
      "comparison-1",
    );
    expect(inputs.find((e) => e.props.name === "rightComparisonId")?.props.value).toBe(
      "comparison-2",
    );
    for (const e of inputs.filter((e) => e.props.type === "radio")) {
      expect(e.props.checked).not.toBe(true);
      expect(e.props.defaultChecked).not.toBe(true);
    }
    expect(inputs.find((e) => e.props.name === "mutationNonce")?.props.value).toBeTypeOf("string");
  });
  it("escapes retained provider markup and uses no remote resource or raw profile payload", async () => {
    const html = renderToStaticMarkup(await page({ campaign: "campaign-1" }));
    expect(html).toContain("&lt;script&gt;source-canary&lt;/script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>source-canary</script>");
    expect(html).not.toContain("PRIVATE_CANDIDATE_CANARY");
  });
  it("keeps every threshold input blank before precommit and hides computed outcomes", async () => {
    const data = view();
    data.campaign = null;
    data.selection = {
      jobIds: ["job-1", "job-2"],
      contextDigest: "d".repeat(64),
      members: [member("1"), member("2")],
    };
    state.view.mockResolvedValue(data);
    const tree = await page({ job: ["job-1", "job-2"] }),
      form = elements(tree).find((e) => e.props.action === state.create);
    expect(form).toBeDefined();
    for (const e of elements(form).filter((e) => e.type === "input" && e.props.type !== "hidden")) {
      expect(e.props.value).toBeUndefined();
      expect(e.props.defaultValue).toBeUndefined();
    }
    expect(text(tree)).not.toContain("Final-version comparison outcomes");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("disables unsupported candidates with fixed escaped hints while keeping provisional choices blank", async () => {
    const data = view();
    data.campaign = null;
    const hints = [
      "PROVISIONAL",
      "RETAINED_SOURCE_MISSING",
      "UNSUPPORTED_PROVIDER",
      "QUALIFIED_LINEAGE_MISSING",
      "OWNER_CORRECTION_UNSUPPORTED",
    ] as const;
    data.candidates = hints.map((availabilityHint, i) => ({
      jobId: `job-hint-${i}`,
      jobVersionId: `version-hint-${i}`,
      title: "<script>hint-title-canary</script>",
      company: "Fictional Company",
      source: "LEVER",
      tenant: "fictional",
      externalId: `post-${i}`,
      retainedPayloadAvailable: availabilityHint !== "RETAINED_SOURCE_MISSING",
      availabilityHint,
    }));
    state.view.mockResolvedValue(data);
    const tree = await page(),
      checks = elements(tree).filter((e) => e.type === "input" && e.props.type === "checkbox");
    expect(checks).toHaveLength(5);
    expect(checks.map((e) => e.props.disabled)).toEqual([false, true, true, true, true]);
    for (const check of checks) {
      expect(check.props.checked).not.toBe(true);
      expect(check.props.defaultChecked).not.toBe(true);
    }
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(
      "Preliminary retained-data checks passed; exact selected preview is still required.",
    );
    expect(html).toContain("a qualified completed-run source lineage is missing");
    expect(html).toContain("retained comparison cannot replay owner corrections");
    expect(html).toContain("&lt;script&gt;hint-title-canary&lt;/script&gt;");
    expect(html).not.toContain("<script>hint-title-canary</script>");
    expect(text(tree)).not.toContain("Final-version comparison outcomes");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("uses a separate exact assessment-bound approval and removes it after current durable qualification", async () => {
    const data = view();
    data.campaign!.readyForOwnerApproval = true;
    state.view.mockResolvedValue(data);
    const tree = await page({ campaign: "campaign-1" });
    const form = elements(tree).find((e) => e.props.action === state.qualify);
    expect(elements(form).find((e) => e.props.name === "assessmentDigest")?.props.value).toBe(
      data.campaign!.assessmentDigest,
    );
    expect(elements(form).find((e) => e.type === "button")?.props.value).toBe("APPROVE");
    data.currentQualificationCampaignId = "campaign-1";
    data.currentQualificationRunId = "qualified-run-1";
    expect(
      elements(await page({ campaign: "campaign-1" })).filter(
        (e) => e.props.action === state.qualify,
      ),
    ).toHaveLength(0);
    expect(state.qualify).not.toHaveBeenCalled();
  });
  it.each(["expired\n", "<script>notice-canary</script>", ["expired"], ["expired", "rejected"]])(
    "ignores spoofed/ambiguous notice %j",
    async (notice) => {
      expect(text(await page({ notice }))).not.toContain("Confirmation expired");
    },
  );
});
