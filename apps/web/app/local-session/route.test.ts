import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ headers: new Headers(), session: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => state.headers }));
vi.mock("@web/lib/local-mutation-security", () => ({
  LOCAL_SESSION_COOKIE: "applypilot_local_session",
  localMutationTokens: { createSession: state.session },
}));
import { GET } from "./route";
beforeEach(() => {
  state.headers = new Headers({ host: "127.0.0.1:3100" });
  state.session.mockReset().mockReturnValue({ token: "fictional-session-token" });
});
describe("local session keeps the validated browser origin", () => {
  it.each([
    "/import",
    "/dashboard",
    "/applications",
    "/sources",
    "/jobs",
    "/jobs/job:fictional",
    "/calibration",
  ])("returns a relative303 for %s despite an internal localhost origin", async (path) => {
    const response = await GET(
      new NextRequest(`http://localhost:3100/local-session?returnTo=${encodeURIComponent(path)}`),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(path);
    expect(new URL(response.headers.get("location")!, "http://127.0.0.1:3100").origin).toBe(
      "http://127.0.0.1:3100",
    );
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(state.session).toHaveBeenCalledOnce();
  });
  it.each([
    "https://attacker.test",
    "//attacker.test",
    "/dashboard\n",
    "/dashboard\r\nX-Test: value",
    " /import",
    "/import ",
    "/jobs/../sources",
  ])("falls back for an unsafe return value %j", async (path) => {
    const response = await GET(
      new NextRequest(`http://localhost:3100/local-session?returnTo=${encodeURIComponent(path)}`),
    );
    expect(response.headers.get("location")).toBe("/dashboard");
  });
  it.each([
    [{ host: "attacker.test" }, "LOCAL_REQUEST_REQUIRED"],
    [{ host: "127.0.0.1:3100", "x-forwarded-host": "attacker.test" }, "FORWARDED_HOST_UNTRUSTED"],
    [{}, "LOCAL_REQUEST_REQUIRED"],
  ])("rejects foreign or forwarded authority before session creation", async (headers, code) => {
    state.headers = new Headers(headers);
    await expect(GET(new NextRequest("http://localhost:3100/local-session"))).rejects.toThrow(code);
    expect(state.session).not.toHaveBeenCalled();
  });
  it("retains Secure on HTTPS", async () => {
    const response = await GET(new NextRequest("https://localhost:3100/local-session"));
    expect(response.headers.get("set-cookie")).toMatch(/; Secure/i);
  });
});
