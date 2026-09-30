import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeLocalMutationNonce: vi.fn(),
  approveOwnerSourceCapability: vi.fn(),
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
}));
vi.mock("@web/lib/source-workspace", () => ({
  approveOwnerSourceCapability: mocks.approveOwnerSourceCapability,
  cancelSourceRun: mocks.cancelSourceRun,
  revokeSourceCapability: mocks.revokeSourceCapability,
  runOwnerApprovedSource: mocks.runOwnerApprovedSource,
}));

import { approveSourceCapabilityAction, startSourceRunAction } from "./actions";

const capabilityId = "capability_123";
const gateProof = {
  action: "SOURCE_CAPABILITY_APPROVE",
  consumedAt: "2026-09-28T00:00:00.000Z",
  loopbackValidated: true as const,
  localSessionValidated: true as const,
  nonceConsumed: true as const,
};

function ownerForm(phrase: string, confirmed = "yes"): FormData {
  const formData = new FormData();
  formData.set("capabilityId", capabilityId);
  formData.set("ownerConfirmed", confirmed);
  formData.set("confirmationText", phrase);
  formData.set("mutationNonce", "fictional-one-use-nonce");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumeLocalMutationNonce.mockResolvedValue(gateProof);
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});

describe("source owner action gates", () => {
  it("records approval only after the exact phrase, checkbox, and approval nonce pass", async () => {
    const formData = ownerForm(`APPROVE ${capabilityId}`);

    await expect(approveSourceCapabilityAction(formData)).rejects.toThrow("REDIRECT:/sources");

    expect(mocks.consumeLocalMutationNonce).toHaveBeenCalledWith(
      "SOURCE_CAPABILITY_APPROVE",
      formData,
    );
    expect(mocks.approveOwnerSourceCapability).toHaveBeenCalledWith(capabilityId, gateProof);
    expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong phrase", `APPROVE ${capabilityId} `, "yes"],
    ["unchecked owner box", `APPROVE ${capabilityId}`, "no"],
  ])("rejects approval with %s before workspace writes", async (_case, phrase, confirmed) => {
    await expect(approveSourceCapabilityAction(ownerForm(phrase, confirmed))).rejects.toThrow(
      "EXACT_OWNER_CONFIRMATION_REQUIRED",
    );

    expect(mocks.approveOwnerSourceCapability).not.toHaveBeenCalled();
    expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
  });

  it("rejects approval when its fresh nonce gate fails before workspace writes", async () => {
    mocks.consumeLocalMutationNonce.mockRejectedValueOnce(new Error("INVALID_MUTATION_NONCE"));

    await expect(
      approveSourceCapabilityAction(ownerForm(`APPROVE ${capabilityId}`)),
    ).rejects.toThrow("INVALID_MUTATION_NONCE");

    expect(mocks.approveOwnerSourceCapability).not.toHaveBeenCalled();
  });

  it("starts only after the separate exact RUN confirmation and start nonce pass", async () => {
    const formData = ownerForm(`RUN ${capabilityId}`);
    mocks.consumeLocalMutationNonce.mockResolvedValue({ ...gateProof, action: "SOURCE_RUN_START" });

    await expect(startSourceRunAction(formData)).rejects.toThrow("REDIRECT:/sources");

    expect(mocks.consumeLocalMutationNonce).toHaveBeenCalledWith("SOURCE_RUN_START", formData);
    expect(mocks.runOwnerApprovedSource).toHaveBeenCalledWith(capabilityId, {
      ...gateProof,
      action: "SOURCE_RUN_START",
    });
    expect(mocks.approveOwnerSourceCapability).not.toHaveBeenCalled();
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
      expect(mocks.approveOwnerSourceCapability).not.toHaveBeenCalled();
    },
  );

  it("rejects start when its fresh nonce gate fails before workspace can create a run", async () => {
    mocks.consumeLocalMutationNonce.mockRejectedValueOnce(new Error("INVALID_MUTATION_NONCE"));

    await expect(startSourceRunAction(ownerForm(`RUN ${capabilityId}`))).rejects.toThrow(
      "INVALID_MUTATION_NONCE",
    );

    expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
  });
});
