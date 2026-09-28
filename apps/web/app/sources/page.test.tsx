import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSourceEnablementView: vi.fn(),
  issueLocalMutationNonce: vi.fn(),
}));

vi.mock("./actions", () => ({
  approveSourceCapabilityAction: vi.fn(),
  cancelSourceRunAction: vi.fn(),
  revokeSourceAction: vi.fn(),
  startSourceRunAction: vi.fn(),
}));
vi.mock("@web/lib/local-mutation-security", () => ({
  issueLocalMutationNonce: mocks.issueLocalMutationNonce,
}));
vi.mock("@web/lib/source-workspace", () => ({
  getSourceEnablementView: mocks.getSourceEnablementView,
}));

import SourcesPage from "./page";

const capability = {
  capabilityId: "fictional-source-capability",
  version: 3,
  source: "LEVER",
  alias: "Fictional Tenant",
  tenant: "fictional-tenant",
  host: "api.lever.co",
  pathPrefix: "/v0/postings/fictional-tenant",
  operations: ["LIST_JOBS"],
  readiness: "SOURCE_ENABLED",
  ownerApprovalState: "APPROVAL_REQUIRED",
  ownerApprovalReceiptId: null,
  canOwnerStart: false,
  policyExpiresAt: "2026-10-01T00:00:00.000Z",
  capabilityExpiresAt: "2026-10-01T00:00:00.000Z",
  requestBudget: 1,
  recordCap: 25,
  pageSizeCap: 25,
  responseByteLimit: 2_000_000,
};

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children)
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.issueLocalMutationNonce.mockImplementation(async (action: string) => `${action}-nonce`);
  mocks.getSourceEnablementView.mockResolvedValue({
    status: "SOURCE_ALLOWLIST_V2_READY",
    capabilities: [capability],
    recentRuns: [
      {
        id: "legacy-fictional-run",
        status: "COMPLETE",
        source: "LEVER",
        alias: "Fictional Tenant",
        requestCount: 1,
        pageCount: 1,
        recordCount: 25,
        providerRecordCount: 25,
        acceptedRecordCount: 25,
        unusableRecordCount: 0,
        providerDriftWarningCount: 0,
        persistedObservationCount: 25,
        safeErrorCode: null,
        transportStage: null,
        schemaDiagnostic: null,
        retryAfter: null,
        startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:00:01.000Z",
        ownerProvenance: "LEGACY_OWNER_PROVENANCE_UNVERIFIED",
      },
    ],
  });
});

describe("source receipt UI", () => {
  it("shows the approval requirement, disables separate start, leaves boxes unchecked, and labels legacy runs", async () => {
    const tree = await SourcesPage();
    const rendered = elements(tree);
    const buttons = rendered.filter((element) => element.type === "button");
    const primaryStartButton = buttons.find(
      (element) => element.props.className === "button button--primary",
    );
    const checkboxes = rendered.filter(
      (element) => element.type === "input" && element.props.type === "checkbox",
    );

    expect(textContent(tree)).toContain("Durable owner approval: APPROVAL REQUIRED");
    expect(textContent(tree)).toContain("APPROVE fictional-source-capability");
    expect(textContent(tree)).toContain("RUN fictional-source-capability");
    expect(textContent(tree)).toContain("LEGACY OWNER ACTION PROVENANCE UNVERIFIED");
    expect(primaryStartButton?.props.disabled).toBe(true);
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    expect(
      checkboxes.every(
        (input) => input.props.checked !== true && input.props.defaultChecked !== true,
      ),
    ).toBe(true);
  });

  it("enables a fresh bounded start only for a current exact-version approval receipt", async () => {
    mocks.getSourceEnablementView.mockResolvedValueOnce({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [
        {
          ...capability,
          ownerApprovalState: "CURRENT",
          ownerApprovalReceiptId: "fictional-approval-receipt",
          canOwnerStart: true,
        },
      ],
      recentRuns: [],
    });

    const tree = await SourcesPage();
    const primaryStartButton = elements(tree).find(
      (element) =>
        element.type === "button" && element.props.className === "button button--primary",
    );

    expect(textContent(tree)).toContain("Durable owner approval: CURRENT");
    expect(textContent(tree)).toContain("receipt fictional-approval-receipt");
    expect(primaryStartButton?.props.disabled).toBe(false);
    expect(mocks.issueLocalMutationNonce).toHaveBeenCalledWith(
      "SOURCE_CAPABILITY_APPROVE",
      "/sources",
    );
    expect(mocks.issueLocalMutationNonce).toHaveBeenCalledWith("SOURCE_RUN_START", "/sources");
  });
});
