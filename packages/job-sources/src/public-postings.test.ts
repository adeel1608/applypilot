import { describe, expect, it, vi } from "vitest";

import {
  boundedPublicGet,
  isBlockedNetworkAddress,
  publicSourceReadiness,
  readGreenhouseJobs,
  readLeverJobs,
  type PublicGetDependencies,
  type PublicPostingCapability,
} from "./index";

const now = new Date("2026-09-07T04:00:00.000Z");

function capability(
  source: "GREENHOUSE" | "LEVER",
  overrides: Partial<PublicPostingCapability> = {},
): PublicPostingCapability {
  const tenant = "fictional";
  return {
    source,
    tenant,
    region: "GLOBAL",
    allowedHost: source === "GREENHOUSE" ? "boards-api.greenhouse.io" : "api.lever.co",
    allowedPathPrefix: source === "GREENHOUSE" ? `/v1/boards/${tenant}/` : `/v0/postings/${tenant}`,
    allowedOperations: ["LIST_JOBS"],
    approved: true,
    policyReviewedAt: "2026-09-01T00:00:00.000Z",
    policyExpiresAt: "2026-10-01T00:00:00.000Z",
    requestBudget: 1,
    recordCap: 10,
    ...overrides,
  };
}

function dependencies(payload: unknown, status = 200): PublicGetDependencies {
  return {
    resolveHost: vi.fn(async () => ["8.8.8.8"]),
    fetch: vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  };
}

describe("default-disabled public posting readers", () => {
  it("requires a current owner-approved local capability", () => {
    expect(publicSourceReadiness(null, now)).toEqual({
      status: "SOURCE_READY_AWAITING_TENANT",
    });
    expect(
      publicSourceReadiness(
        capability("GREENHOUSE", { policyExpiresAt: "2026-09-01T00:00:00.000Z" }),
        now,
      ),
    ).toEqual({ status: "SOURCE_DISABLED", reason: "CAPABILITY_EXPIRED" });
  });

  it("maps bounded official Greenhouse GET data without authentication", async () => {
    const deps = dependencies({
      jobs: [
        {
          id: 123,
          title: "Fictional Service Role",
          absolute_url: "https://boards.greenhouse.io/fictional/jobs/123",
          location: { name: "Melbourne VIC" },
          content: "A fictional role.",
          updated_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    const jobs = await readGreenhouseJobs(capability("GREENHOUSE"), {
      now,
      dependencies: deps,
    });
    expect(jobs[0]).toMatchObject({
      source: "GREENHOUSE",
      externalId: "123",
      title: "Fictional Service Role",
    });
    expect(deps.fetch).toHaveBeenCalledOnce();
    const init = vi.mocked(deps.fetch).mock.calls[0]?.[1];
    expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "manual" });
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization|cookie|candidate/i);
  });

  it("maps the official Lever public postings shape", async () => {
    const deps = dependencies([
      {
        id: "lever-1",
        text: "Fictional Technical Role",
        hostedUrl: "https://jobs.lever.co/fictional/lever-1",
        applyUrl: "https://jobs.lever.co/fictional/lever-1/apply",
        descriptionPlain: "A fictional role.",
        categories: { location: "Sydney NSW" },
        createdAt: 1788230400000,
      },
    ]);
    const jobs = await readLeverJobs(capability("LEVER"), { now, dependencies: deps });
    expect(jobs[0]).toMatchObject({
      source: "LEVER",
      externalId: "lever-1",
      title: "Fictional Technical Role",
    });
  });

  it("denies local, private, link-local, mapped, metadata, and documentation addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
    ]) {
      expect(isBlockedNetworkAddress(address), address).toBe(true);
    }
    expect(isBlockedNetworkAddress("8.8.8.8")).toBe(false);
  });

  it("revalidates redirects and stops before a non-allowlisted destination", async () => {
    const deps: PublicGetDependencies = {
      resolveHost: vi.fn(async () => ["8.8.8.8"]),
      fetch: vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example.test/collect" },
          }),
      ),
    };
    await expect(
      boundedPublicGet(
        "https://boards-api.greenhouse.io/v1/boards/fictional/jobs",
        capability("GREENHOUSE", { requestBudget: 2 }),
        { now, dependencies: deps },
      ),
    ).rejects.toThrow("HOST_NOT_ALLOWLISTED");
    expect(deps.fetch).toHaveBeenCalledOnce();
  });

  it("stops on rate limiting and enforces response and record caps", async () => {
    await expect(
      readLeverJobs(capability("LEVER"), { now, dependencies: dependencies({}, 429) }),
    ).rejects.toThrow("RATE_LIMITED_STOP");
    await expect(
      readGreenhouseJobs(capability("GREENHOUSE", { recordCap: 1 }), {
        now,
        dependencies: dependencies({
          jobs: [
            { id: 1, title: "One", absolute_url: "https://example.test/1" },
            { id: 2, title: "Two", absolute_url: "https://example.test/2" },
          ],
        }),
      }),
    ).rejects.toThrow("RECORD_CAP_EXCEEDED");
  });
});
