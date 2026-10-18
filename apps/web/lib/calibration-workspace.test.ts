import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { testProfile } from "../../../tests/fixture-data";

const state = vi.hoisted(() => ({
  profile: vi.fn(),
  available: vi.fn(),
  candidates: vi.fn(),
  campaigns: vi.fn(),
  create: vi.fn(),
  label: vi.fn(),
  pair: vi.fn(),
  qualify: vi.fn(),
  preview: vi.fn(),
  profileHash: vi.fn(),
  safety: vi.fn(),
  database: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./local-data-directory", () => ({
  resolveLocalDataDirectory: () => "C:/fictional-intake/data",
}));
vi.mock("./local-database", () => ({ getLocalDatabase: state.database }));
vi.mock("../../../scripts/lib/r2-calibration-safety", () => ({
  readCurrentR2CalibrationProfileHash: state.profileHash,
  readCurrentR2CalibrationSafety: state.safety,
}));
vi.mock("@applypilot/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@applypilot/database")>()),
  R2CalibrationIntakeRepository: class {
    available = state.available;
    currentProfile = state.profile;
    listCandidates = state.candidates;
    listCampaigns = state.campaigns;
    createCampaign = state.create;
    recordLabel = state.label;
    recordPair = state.pair;
    approveQualification = state.qualify;
    previewCampaign = state.preview;
  },
}));
import {
  getCalibrationView,
  createCalibrationCampaign,
  approveCalibrationQualification,
} from "./calibration-workspace";

const gate = {
  action: "CAL_CREATE_" + "A".repeat(64),
  consumedAt: "2026-10-18T00:00:00.000Z",
  loopbackValidated: true as const,
  localSessionValidated: true as const,
  nonceConsumed: true as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.available.mockReturnValue(true);
  state.database.mockReturnValue({ sqlite: {} });
  const profile = CandidateProfileSchema.parse({
    ...testProfile,
    identity: {
      ...testProfile.identity,
      firstName: { value: "PRIVATE_IDENTITY_CANARY", verification: "VERIFIED" },
    },
    contact: {
      ...testProfile.contact,
      email: { value: "private-contact-canary@example.invalid", verification: "VERIFIED" },
    },
    skills: [
      { id: "verified-skill", name: "Visible verified skill", verification: "VERIFIED" },
      { id: "unknown-skill", name: "UNKNOWN_FACT_CANARY", verification: "UNKNOWN" },
    ],
  });
  const profileHash = candidateProfileContentHash(profile);
  state.profile.mockReturnValue({ profileVersionId: "profile-version-1", profileHash, profile });
  state.profileHash.mockReturnValue(profileHash);
  state.candidates.mockReturnValue([]);
  state.campaigns.mockReturnValue([]);
  state.safety.mockImplementation(() => {
    throw new Error("R2_CALIBRATION_SAFETY_EVIDENCE_INVALID");
  });
  state.create.mockReturnValue("campaign-1");
});

describe("private calibration workspace projection", () => {
  it("includes relevant verified facts but excludes unknown facts, identity/contact and raw profile", async () => {
    const view = await getCalibrationView();
    const body = JSON.stringify(view);
    expect(view.status).toBe("READY");
    expect(body).toContain("Visible verified skill");
    expect(body).not.toContain("UNKNOWN_FACT_CANARY");
    expect(body).not.toContain("PRIVATE_IDENTITY_CANARY");
    expect(body).not.toContain("private-contact-canary");
    expect(body).not.toContain("snapshotJson");
    expect(view.currentQualificationRunId).toBeNull();
  });
  it("refuses a private file/profile snapshot mismatch before any write", async () => {
    state.profileHash.mockReturnValue("0".repeat(64));
    const view = await getCalibrationView();
    expect(view.status).toBe("PROFILE_REQUIRED");
    expect(view.safeCode).toBe("R2_CALIBRATION_PROFILE_CHANGED");
    await expect(createCalibrationCampaign({}, gate)).rejects.toThrow(
      "R2_CALIBRATION_PROFILE_CHANGED",
    );
    expect(state.create).not.toHaveBeenCalled();
  });
  it("does not initialize or migrate a missing database/intake schema", async () => {
    state.database.mockReturnValue(null);
    expect((await getCalibrationView()).status).toBe("MIGRATION_REQUIRED");
    state.database.mockReturnValue({ sqlite: {} });
    state.available.mockReturnValue(false);
    expect((await getCalibrationView()).status).toBe("MIGRATION_REQUIRED");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("renders a fixed code for private SQL/source errors and cannot accept a substitute safety approval", async () => {
    state.candidates.mockImplementation(() => {
      throw new Error("PRIVATE_SOURCE_CANARY candidate payload");
    });
    const view = await getCalibrationView();
    expect(view.safeCode).toBe("R2_CALIBRATION_UNAVAILABLE");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SOURCE_CANARY");
    await expect(
      approveCalibrationQualification(
        { campaignId: "campaign-1", assessmentDigest: "a".repeat(64) },
        gate,
      ),
    ).rejects.toThrow("R2_CALIBRATION_SAFETY_EVIDENCE_INVALID");
    expect(state.qualify).not.toHaveBeenCalled();
  });
});
