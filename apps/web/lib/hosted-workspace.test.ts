import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ database: vi.fn(), prepare: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./local-database", () => ({ getLocalDatabase: mocks.database }));
vi.mock("./beta-workspace", () => ({ preparePrivatePacket: mocks.prepare }));
import { stopHostedSession } from "./hosted-workspace";
const runtime = globalThis as typeof globalThis & { __applypilotHostedService?: unknown };
afterEach(() => {
  delete runtime.__applypilotHostedService;
  vi.resetAllMocks();
});
describe("hosted STOP remains containment when execution admission is unavailable", () => {
  it.each(["missing seal", "changed compiled build"])(
    "closes the retained owned service with %s without consulting execution admission",
    async () => {
      const stop = vi.fn().mockResolvedValue(undefined);
      mocks.database.mockImplementation(() => {
        throw new Error("EXECUTION_ADMISSION_MUST_NOT_RUN_FOR_STOP");
      });
      runtime.__applypilotHostedService = {
        buildDigest: "previous-reviewed-build",
        service: { stop },
      };
      await expect(stopHostedSession("fictional-owned-session")).resolves.toBeUndefined();
      expect(stop).toHaveBeenCalledExactlyOnceWith("fictional-owned-session");
      expect(mocks.database).not.toHaveBeenCalled();
    },
  );
});
