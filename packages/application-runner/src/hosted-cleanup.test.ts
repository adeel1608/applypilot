import { describe, expect, it, vi } from "vitest";
import { HostedApplicationService } from "./hosted-workflow";
import type { HostedWorkflowStore } from "./hosted-workflow";
import type { HostedApplicationDriver } from "./hosted-contract";
import { diagnosticCapability } from "../../../tests/helpers/hosted-diagnostic-fixture";
import { fictionalHostedProof } from "../../../tests/helpers/hosted-fixture";
import { hostedDiagnostic } from "./hosted-diagnostics";
describe("owned hosted driver cleanup under durable failures", () => {
  it.each(["thrown with audit failure", "returned unknown"] as const)(
    "retains submit %s through cleanup failure without a second activation",
    async (kind) => {
      const diagnostic = hostedDiagnostic("HOSTED_DESTINATION_FORBIDDEN", {
        site: "ROUTE_READ_DESTINATION",
        stage: "SUBMIT",
      });
      const close = vi.fn().mockRejectedValue(new Error("private-canary"));
      const driver = {
        verify: async () => ({ valuesDigest: "a", uploadsDigest: "b" }),
        submit: vi.fn(async () => {
          if (kind === "thrown with audit failure") throw new Error("HOSTED_DESTINATION_FORBIDDEN");
          return {
            state: "OUTCOME_UNKNOWN",
            safeStopCode: "HOSTED_DESTINATION_FORBIDDEN",
            rejectionDiagnostic: diagnostic,
          };
        }),
        getRejectionDiagnostic: () => diagnostic,
        close,
      } as unknown as HostedApplicationDriver;
      let state = "REVIEW_READY";
      const store = {
        getSession: () => ({
          id: "fictional",
          state,
          capability: diagnosticCapability(),
          preview: { valuesDigest: "a", uploadsDigest: "b" },
          proofs: [],
          mapping: [],
          safeStopCode: state === "OUTCOME_UNKNOWN" ? "HOSTED_DESTINATION_FORBIDDEN" : null,
          rejectionDiagnostic: state === "OUTCOME_UNKNOWN" ? diagnostic : null,
        }),
        resolvePacket: () => ({}),
        authorizeSubmit: vi.fn(() => "fictional-claim"),
        complete: () => {
          state = "OUTCOME_UNKNOWN";
        },
        stop: () => {
          state = "OUTCOME_UNKNOWN";
          throw new Error("HOSTED_AUDIT_PERSISTENCE_FAILED");
        },
      } as unknown as HostedWorkflowStore;
      const service = new HostedApplicationService({
        store,
        reviewedBuild: diagnosticCapability().build,
        driverFactory: () => driver,
      });
      const owned = service as unknown as {
        drivers: Map<string, HostedApplicationDriver>;
        inFlight: Set<string>;
      };
      owned.drivers.set("fictional", driver);
      const run = service.submit("fictional", fictionalHostedProof("fictional-action"));
      if (kind === "thrown with audit failure")
        await expect(run).rejects.toMatchObject({
          message: "HOSTED_TRANSPORT_OUTCOME_UNKNOWN",
          auditPersistenceFailed: true,
          cleanupFailed: true,
          diagnostic,
        });
      else
        await expect(run).resolves.toMatchObject({
          state: "OUTCOME_UNKNOWN",
          rejectionDiagnostic: diagnostic,
          cleanupFailed: true,
        });
      expect(store.authorizeSubmit).toHaveBeenCalledTimes(1);
      expect(driver.submit).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(owned.drivers.size).toBe(0);
      expect(owned.inFlight.size).toBe(0);
      await expect(
        service.submit("fictional", fictionalHostedProof("fictional-replay")),
      ).rejects.toThrow("HOSTED_CONTEXT_LOST");
    },
  );
  it.each(["inspect", "prepare"] as const)(
    "contains %s even if optional diagnostic acquisition throws",
    async (operation) => {
      const close = vi.fn().mockResolvedValue(undefined),
        stop = vi.fn();
      const driver = {
        inspect: async () => {
          throw new Error("HOSTED_DESTINATION_FORBIDDEN");
        },
        getRejectionDiagnostic: () => {
          throw new Error("private-canary");
        },
        close,
      } as unknown as HostedApplicationDriver;
      const store = {
        openSession: () => ({ id: "fictional" }),
        getSession: () => ({ state: "INSPECTED", form: null, discovery: null }),
        bindApplication: () => undefined,
        resolvePacket: () => {
          throw new Error("HOSTED_DESTINATION_FORBIDDEN");
        },
        stop,
      } as unknown as HostedWorkflowStore;
      const service = new HostedApplicationService({
        store,
        reviewedBuild: diagnosticCapability().build,
        driverFactory: () => driver,
      });
      if (operation === "prepare")
        (service as unknown as { drivers: Map<string, HostedApplicationDriver> }).drivers.set(
          "fictional",
          driver,
        );
      const proof = fictionalHostedProof("fictional-action");
      await expect(
        operation === "inspect"
          ? service.inspect(diagnosticCapability(), proof)
          : service.prepare("fictional", diagnosticCapability(), proof),
      ).rejects.toMatchObject({
        message: "HOSTED_DESTINATION_FORBIDDEN",
        diagnostic: { site: "UNKNOWN_REJECTION_SITE" },
      });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(
        (service as unknown as { drivers: Map<string, HostedApplicationDriver> }).drivers.size,
      ).toBe(0);
    },
  );
  it("closes every retained driver even when session reads and one close fail", async () => {
    const store = {
      getSession: vi.fn(() => {
        throw new Error("fictional unreadable session");
      }),
    } as unknown as HostedWorkflowStore;
    const service = new HostedApplicationService({
      store,
      reviewedBuild: {
        head: "a".repeat(40),
        tree: "b".repeat(40),
        buildDigest: "c".repeat(64),
        adapterVersion: "hosted-native-v1",
      },
      driverFactory: () => {
        throw new Error("NO_NEW_BROWSER_PERMITTED");
      },
    });
    const drivers = (service as unknown as { drivers: Map<string, HostedApplicationDriver> })
      .drivers;
    const first = vi.fn().mockRejectedValue(new Error("fictional close failure")),
      second = vi.fn().mockResolvedValue(undefined);
    drivers.set("first", { close: first } as unknown as HostedApplicationDriver);
    drivers.set("second", { close: second } as unknown as HostedApplicationDriver);
    await expect(service.close()).rejects.toThrow("HOSTED_SHUTDOWN_INCOMPLETE");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(drivers.size).toBe(0);
  });
});
