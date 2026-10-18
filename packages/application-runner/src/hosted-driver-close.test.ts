import { describe, expect, it, vi } from "vitest";
import { PlaywrightHostedApplicationDriver } from "./hosted-driver";

/** Production close method with isolated owned handles; no browser launch, listener or request. */
function fixture() {
  const driver = new PlaywrightHostedApplicationDriver(),
    contextClose = vi.fn(async () => {}),
    browserClose = vi.fn(async () => {}),
    connections = vi.fn();
  const proxyClose = vi.fn((callback: (error?: Error) => void) => callback());
  const owned = driver as unknown as {
    page: unknown;
    context: unknown;
    browser: unknown;
    denyingProxy: unknown;
  };
  owned.page = {};
  owned.context = { close: contextClose };
  owned.browser = { close: browserClose };
  owned.denyingProxy = { closeAllConnections: connections, close: proxyClose };
  return { driver, owned, contextClose, browserClose, connections, proxyClose };
}
describe("production hosted driver cleanup", () => {
  it.each([
    "context",
    "browser",
    "context-sync",
    "browser-sync",
    "proxy-connections",
    "proxy-callback",
    "proxy-sync",
  ])("reports %s failure safely after attempting all owned cleanup", async (failure) => {
    const f = fixture(),
      privateError = new Error("fictional-private-canary");
    if (failure === "context") f.contextClose.mockRejectedValue(privateError);
    if (failure === "browser") f.browserClose.mockRejectedValue(privateError);
    if (failure === "context-sync")
      f.contextClose.mockImplementation(() => {
        throw privateError;
      });
    if (failure === "browser-sync")
      f.browserClose.mockImplementation(() => {
        throw privateError;
      });
    if (failure === "proxy-connections")
      f.connections.mockImplementation(() => {
        throw privateError;
      });
    if (failure === "proxy-callback")
      f.proxyClose.mockImplementation((callback) => callback(privateError));
    if (failure === "proxy-sync")
      f.proxyClose.mockImplementation(() => {
        throw privateError;
      });
    await expect(f.driver.close()).rejects.toThrow(/^HOSTED_DRIVER_CLEANUP_FAILED$/);
    for (const close of [f.contextClose, f.browserClose, f.connections, f.proxyClose])
      expect(close).toHaveBeenCalledTimes(1);
    expect(f.owned).toMatchObject({ page: null, context: null, browser: null, denyingProxy: null });
  });
  it("closes each resource once and permits repeated successful cleanup", async () => {
    const f = fixture();
    await f.driver.close();
    await f.driver.close();
    for (const close of [f.contextClose, f.browserClose, f.connections, f.proxyClose])
      expect(close).toHaveBeenCalledTimes(1);
    expect(f.owned).toMatchObject({ page: null, context: null, browser: null, denyingProxy: null });
  });
  it("shares pending cleanup and its failure with concurrent callers without retry", async () => {
    const f = fixture();
    let release!: () => void;
    f.contextClose.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    f.browserClose.mockRejectedValue(new Error("fictional-private-canary"));
    const first = f.driver.close(),
      second = f.driver.close();
    release();
    const results = await Promise.allSettled([first, second]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ message: "HOSTED_DRIVER_CLEANUP_FAILED" });
    }
    for (const close of [f.contextClose, f.browserClose, f.connections, f.proxyClose])
      expect(close).toHaveBeenCalledTimes(1);
    await expect(f.driver.close()).rejects.toThrow(/^HOSTED_DRIVER_CLEANUP_FAILED$/);
    expect(f.browserClose).toHaveBeenCalledTimes(1);
  });
});
