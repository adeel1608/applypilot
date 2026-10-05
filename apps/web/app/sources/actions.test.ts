import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeLocalMutationNonce: vi.fn(),
  consumeLocalMutationNonceBatch: vi.fn(),
  approveAndRunOwnerSource: vi.fn(),
  runOwnerApprovedSource: vi.fn(),
  cancelSourceRun: vi.fn(),
  revokeSourceCapability: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@web/lib/local-mutation-security", () => ({
  consumeLocalMutationNonce: mocks.consumeLocalMutationNonce,
  consumeLocalMutationNonceBatch: mocks.consumeLocalMutationNonceBatch,
}));
vi.mock("@web/lib/source-workspace", () => ({
  approveAndRunOwnerSource: mocks.approveAndRunOwnerSource,
  cancelSourceRun: mocks.cancelSourceRun,
  revokeSourceCapability: mocks.revokeSourceCapability,
  runOwnerApprovedSource: mocks.runOwnerApprovedSource,
}));

import {
  approveAndStartSourceRunAction,
  revokeSourceAction,
  startSourceRunAction,
} from "./actions";

const capabilityId = "capability_123";
const capabilityVersion = 3;
const capabilityDigest = "a".repeat(64);
const capabilityBinding = { capabilityId, version: capabilityVersion, capabilityDigest };
const approvalGateProof = {
  action: "SOURCE_CAPABILITY_APPROVE",
  consumedAt: "2026-09-28T00:00:00.000Z",
  loopbackValidated: true as const,
  localSessionValidated: true as const,
  nonceConsumed: true as const,
};
const startGateProof = { ...approvalGateProof, action: "SOURCE_RUN_START" };

function ownerForm(phrase: string, confirmed = "yes"): FormData {
  const formData = new FormData();
  formData.set("capabilityId", capabilityId);
  formData.set("capabilityVersion", String(capabilityVersion));
  formData.set("capabilityDigest", capabilityDigest);
  formData.set("ownerConfirmed", confirmed);
  formData.set("confirmationText", phrase);
  formData.set("mutationNonce", "fictional-one-use-nonce");
  formData.set("approvalMutationNonce", "fictional-approval-one-use-nonce");
  formData.set("startMutationNonce", "fictional-start-one-use-nonce");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumeLocalMutationNonce.mockResolvedValue(approvalGateProof);
  mocks.consumeLocalMutationNonceBatch.mockResolvedValue([approvalGateProof, startGateProof]);
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});

describe("source owner action gates", () => {
  it("uses both independently named nonce proofs for the exact combined owner action", async () => {
    const formData = ownerForm(`APPROVE AND RUN ${capabilityId}`);

    await expect(approveAndStartSourceRunAction(formData)).rejects.toThrow("REDIRECT:/sources");

    expect(mocks.consumeLocalMutationNonceBatch).toHaveBeenCalledWith(
      [
        { action: "SOURCE_CAPABILITY_APPROVE", fieldName: "approvalMutationNonce" },
        { action: "SOURCE_RUN_START", fieldName: "startMutationNonce" },
      ],
      formData,
    );
    expect(mocks.approveAndRunOwnerSource).toHaveBeenCalledExactlyOnceWith(
      capabilityBinding,
      { approval: approvalGateProof, start: startGateProof },
      `APPROVE AND RUN ${capabilityId}`,
    );
    expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sources");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/jobs");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it.each([
    ["wrong phrase", `APPROVE AND RUN ${capabilityId} `, "yes"],
    ["unchecked owner box", `APPROVE AND RUN ${capabilityId}`, "no"],
  ])(
    "rejects the combined action with %s before workspace writes",
    async (_case, phrase, confirmed) => {
      await expect(approveAndStartSourceRunAction(ownerForm(phrase, confirmed))).rejects.toThrow(
        "EXACT_OWNER_CONFIRMATION_REQUIRED",
      );
      expect(mocks.approveAndRunOwnerSource).not.toHaveBeenCalled();
      expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
    },
  );

  it("rejects ambiguous duplicate confirmation and capability-binding fields", async () => {
    const duplicatePhrase = ownerForm(`APPROVE AND RUN ${capabilityId}`);
    duplicatePhrase.append("confirmationText", `APPROVE AND RUN ${capabilityId}`);
    await expect(approveAndStartSourceRunAction(duplicatePhrase)).rejects.toThrow(
      "EXACT_OWNER_CONFIRMATION_REQUIRED",
    );

    const duplicateBinding = ownerForm(`APPROVE AND RUN ${capabilityId}`);
    duplicateBinding.append("capabilityDigest", capabilityDigest);
    await expect(approveAndStartSourceRunAction(duplicateBinding)).rejects.toThrow(
      "SOURCE_CAPABILITY_VIEW_STALE",
    );
    expect(mocks.approveAndRunOwnerSource).not.toHaveBeenCalled();
  });

  it("rejects the combined action when either nonce proof fails before workspace writes", async () => {
    mocks.consumeLocalMutationNonceBatch.mockRejectedValueOnce(new Error("INVALID_MUTATION_NONCE"));
    await expect(
      approveAndStartSourceRunAction(ownerForm(`APPROVE AND RUN ${capabilityId}`)),
    ).rejects.toThrow("INVALID_MUTATION_NONCE");
    expect(mocks.approveAndRunOwnerSource).not.toHaveBeenCalled();
  });

  it.each([
    ["missing version", (form: FormData) => form.delete("capabilityVersion")],
    ["malformed version", (form: FormData) => form.set("capabilityVersion", "03")],
    ["missing digest", (form: FormData) => form.delete("capabilityDigest")],
    ["malformed digest", (form: FormData) => form.set("capabilityDigest", "not-a-digest")],
  ])("rejects %s before workspace writes", async (_case, mutate) => {
    const form = ownerForm(`APPROVE AND RUN ${capabilityId}`);
    mutate(form);
    await expect(approveAndStartSourceRunAction(form)).rejects.toThrow(
      "SOURCE_CAPABILITY_VIEW_STALE",
    );
    expect(mocks.approveAndRunOwnerSource).not.toHaveBeenCalled();
  });

  it("starts only after the separate exact RUN confirmation and start nonce pass", async () => {
    const formData = ownerForm(`RUN ${capabilityId}`);
    mocks.consumeLocalMutationNonce.mockResolvedValue(startGateProof);

    await expect(startSourceRunAction(formData)).rejects.toThrow("REDIRECT:/sources");

    expect(mocks.consumeLocalMutationNonce).toHaveBeenCalledWith("SOURCE_RUN_START", formData);
    expect(mocks.runOwnerApprovedSource).toHaveBeenCalledWith(capabilityBinding, {
      ...approvalGateProof,
      action: "SOURCE_RUN_START",
    });
    expect(mocks.approveAndRunOwnerSource).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong phrase", `RUN ${capabilityId} `, "yes"],
    ["unchecked owner box", `RUN ${capabilityId}`, "no"],
  ])(
    "rejects start with %s before workspace can create a run",
    async (_case, phrase, confirmed) => {
      await expect(startSourceRunAction(ownerForm(phrase, confirmed))).rejects.toThrow(
        "EXACT_OWNER_CONFIRMATION_REQUIRED",
      );

      expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
      expect(mocks.approveAndRunOwnerSource).not.toHaveBeenCalled();
    },
  );

  it("rejects start when its fresh nonce gate fails before workspace can create a run", async () => {
    mocks.consumeLocalMutationNonce.mockRejectedValueOnce(new Error("INVALID_MUTATION_NONCE"));

    await expect(startSourceRunAction(ownerForm(`RUN ${capabilityId}`))).rejects.toThrow(
      "INVALID_MUTATION_NONCE",
    );

    expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
  });

  it("passes the full exact view binding through the REVOKE action", async () => {
    const form = ownerForm(`REVOKE ${capabilityId}`);
    await expect(revokeSourceAction(form)).rejects.toThrow("REDIRECT:/sources");
    expect(mocks.consumeLocalMutationNonce).toHaveBeenCalledWith("SOURCE_REVOKE", form);
    expect(mocks.revokeSourceCapability).toHaveBeenCalledWith(capabilityBinding);
  });
});
