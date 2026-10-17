import { describe, expect, it, vi } from "vitest";
import { HostedApplicationService } from "./hosted-workflow";
import type { HostedWorkflowStore } from "./hosted-workflow";
import type { HostedApplicationDriver } from "./hosted-contract";
describe("owned hosted driver cleanup under durable failures", () => {
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
