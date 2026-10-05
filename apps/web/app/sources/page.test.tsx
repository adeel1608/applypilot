import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSourceEnablementView: vi.fn(),
  issueLocalMutationNonce: vi.fn(),
  combinedAction: vi.fn(),
  startAction: vi.fn(),
  revokeAction: vi.fn(),
  cancelAction: vi.fn(),
}));

vi.mock("./actions", () => ({
  approveAndStartSourceRunAction: mocks.combinedAction,
  cancelSourceRunAction: mocks.cancelAction,
  revokeSourceAction: mocks.revokeAction,
  startSourceRunAction: mocks.startAction,
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
  configurationDigest: "a".repeat(64),
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

const greenhouseCapability = {
  ...capability,
  capabilityId: "fictional-greenhouse-capability",
  source: "GREENHOUSE",
  alias: "Fictional Greenhouse Board",
  tenant: "fictional-greenhouse",
  host: "boards-api.greenhouse.io",
  pathPrefix: "/v1/boards/fictional-greenhouse/",
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
  it("shows one combined owner form for APPROVAL_REQUIRED and leaves boxes unchecked", async () => {
    const tree = await SourcesPage();
    const rendered = elements(tree);
    const codeText = rendered
      .filter((element) => element.type === "code")
      .map((element) => textContent(element));
    const buttons = rendered.filter((element) => element.type === "button");
    const combinedButton = buttons.find((element) =>
      textContent(element.props.children as ReactNode).includes(
        "Approve & start bounded source read",
      ),
    );
    const checkboxes = rendered.filter(
      (element) => element.type === "input" && element.props.type === "checkbox",
    );
    const sourceForms = rendered.filter(
      (element) => element.type === "form" && element.props.className === "import-form",
    );

    expect(textContent(tree)).toContain("Durable owner approval: APPROVAL REQUIRED");
    expect(textContent(tree)).toContain("Approve and start this exact bounded source read");
    expect(textContent(tree)).toContain(
      `Capability digest ${capability.configurationDigest.slice(0, 12)}`,
    );
    expect(codeText).toContain("APPROVE AND RUN fictional-source-capability");
    expect(codeText).not.toContain("RUN fictional-source-capability");
    expect(textContent(tree)).toContain("LEGACY OWNER ACTION PROVENANCE UNVERIFIED");
    expect(combinedButton?.props.disabled).not.toBe(true);
    expect(sourceForms).toHaveLength(2);
    expect(checkboxes).toHaveLength(2);
    expect(
      checkboxes.every(
        (input) => input.props.checked !== true && input.props.defaultChecked !== true,
      ),
    ).toBe(true);
  });

  it("binds every owner form to the same exact displayed capability head", async () => {
    const tree = await SourcesPage();
    const sourceForms = elements(tree).filter(
      (element) => element.type === "form" && element.props.className === "import-form",
    );

    expect(sourceForms).toHaveLength(2);
    for (const form of sourceForms) {
      const inputs = elements(form);
      expect(inputs.find((input) => input.props.name === "capabilityId")?.props.value).toBe(
        capability.capabilityId,
      );
      expect(inputs.find((input) => input.props.name === "capabilityVersion")?.props.value).toBe(
        capability.version,
      );
      expect(inputs.find((input) => input.props.name === "capabilityDigest")?.props.value).toBe(
        capability.configurationDigest,
      );
    }
    const combinedForm = sourceForms.find((form) => form.props.action === mocks.combinedAction);
    const combinedInputs = elements(combinedForm);
    expect(
      combinedInputs.find((input) => input.props.name === "approvalMutationNonce")?.props.value,
    ).toBe("SOURCE_CAPABILITY_APPROVE-nonce");
    expect(
      combinedInputs.find((input) => input.props.name === "startMutationNonce")?.props.value,
    ).toBe("SOURCE_RUN_START-nonce");
  });

  it("keeps a revoked latest head visible without approval or run actions", async () => {
    mocks.getSourceEnablementView.mockResolvedValueOnce({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [
        {
          ...capability,
          version: 3,
          readiness: "SOURCE_DISABLED",
          ownerApprovalState: "REVOKED",
          ownerApprovalReceiptId: null,
          canOwnerStart: false,
        },
      ],
      recentRuns: [],
    });

    const tree = await SourcesPage();
    const formVersions = elements(tree)
      .filter((element) => element.type === "input" && element.props.name === "capabilityVersion")
      .map((input) => input.props.value);

    expect(textContent(tree)).toContain("Durable owner approval: REVOKED");
    expect(textContent(tree)).not.toContain("APPROVE AND RUN");
    expect(textContent(tree)).not.toContain("RUN fictional-source-capability");
    expect(formVersions).toEqual([3]);
  });

  it("keeps legacy CURRENT approvals on a RUN-only recovery form", async () => {
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
    const rendered = elements(tree);
    const runButton = rendered.find(
      (element) =>
        element.type === "button" &&
        textContent(element.props.children as ReactNode).includes("Start bounded source read"),
    );
    const forms = rendered.filter(
      (element) => element.type === "form" && element.props.className === "import-form",
    );

    expect(textContent(tree)).toContain("Durable owner approval: CURRENT");
    expect(textContent(tree)).toContain("receipt fictional-approval-receipt");
    expect(textContent(tree)).toContain("RUN fictional-source-capability");
    expect(textContent(tree)).not.toContain("APPROVE AND RUN");
    expect(runButton?.props.disabled).not.toBe(true);
    expect(forms).toHaveLength(2);
    expect(
      forms.some((form) =>
        elements(form).some((input) => input.props.name === "approvalMutationNonce"),
      ),
    ).toBe(false);
    expect(mocks.issueLocalMutationNonce).not.toHaveBeenCalledWith(
      "SOURCE_CAPABILITY_APPROVE",
      "/sources",
    );
    expect(mocks.issueLocalMutationNonce).toHaveBeenCalledWith("SOURCE_RUN_START", "/sources");
  });

  it("shows the combined one-click flow for Greenhouse APPROVAL_REQUIRED state", async () => {
    mocks.getSourceEnablementView.mockResolvedValueOnce({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [
        {
          ...greenhouseCapability,
          ownerApprovalState: "APPROVAL_REQUIRED",
          ownerApprovalReceiptId: null,
          canOwnerStart: false,
        },
      ],
      recentRuns: [],
    });

    const tree = await SourcesPage();
    const buttons = elements(tree).filter((element) => element.type === "button");
    const combinedButton = buttons.find((element) =>
      textContent(element.props.children as ReactNode).includes(
        "Approve & start bounded source read",
      ),
    );

    expect(textContent(tree)).toContain("GREENHOUSE · Fictional Greenhouse Board");
    expect(textContent(tree)).toContain("APPROVE AND RUN fictional-greenhouse-capability");
    expect(combinedButton?.props.disabled).not.toBe(true);
    expect(
      buttons.filter((element) => element.props.className === "button button--primary"),
    ).toHaveLength(1);
  });

  it("does not offer source actions for a terminal approval state", async () => {
    mocks.getSourceEnablementView.mockResolvedValueOnce({
      status: "SOURCE_ALLOWLIST_V2_READY",
      capabilities: [
        {
          ...greenhouseCapability,
          ownerApprovalState: "CONSUMED",
          ownerApprovalReceiptId: "fictional-greenhouse-approval",
          canOwnerStart: false,
        },
      ],
      recentRuns: [],
    });

    const tree = await SourcesPage();
    expect(textContent(tree)).toContain("Durable owner approval: CONSUMED");
    expect(textContent(tree)).not.toContain("APPROVE AND RUN");
    expect(textContent(tree)).not.toContain("RUN fictional-greenhouse-capability");
  });
});
