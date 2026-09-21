import { randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";

import {
  assertGreenBannerChildDigest,
  GreenBannerChildCapabilitySchema,
  GreenBannerParentGrantSchema,
  type GreenBannerChildCapability,
  type GreenBannerParentGrant,
} from "@applypilot/application-runner";

type ParentEventState = "ACTIVE" | "REVOKED" | "COMPLETED";
type ChildEventState = "ACTIVE" | "CONSUMED" | "REVOKED" | "EXPIRED";

function json(value: unknown): string {
  return JSON.stringify(value);
}

export class GreenBannerGrantRepository {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  persistParentGrant(grantInput: GreenBannerParentGrant): { id: string; created: boolean } {
    const grant = GreenBannerParentGrantSchema.parse(grantInput);
    const existing = this.sqlite
      .prepare("SELECT id,grant_digest AS grantDigest FROM green_banner_parent_grants WHERE id=?")
      .get(grant.grantId) as { id: string; grantDigest: string } | undefined;
    if (existing) {
      if (existing.grantDigest !== grant.grantDigest)
        throw new Error("PARENT_GRANT_IMMUTABLE_CONFLICT");
      return { id: existing.id, created: false };
    }
    const insert = this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO green_banner_parent_grants
           (id,grant_type,grant_digest,allowed_operations_json,scope_json,main_sha,created_at)
           VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          grant.grantId,
          grant.grantType,
          grant.grantDigest,
          json(grant.allowedOperations),
          json(grant.scope),
          grant.mainSha,
          grant.createdAt,
        );
      this.sqlite
        .prepare(
          `INSERT INTO green_banner_parent_grant_events
           (id,parent_grant_id,sequence,state,safe_metadata_json,occurred_at)
           VALUES (?,?,?,?,?,?)`,
        )
        .run(this.id(), grant.grantId, 0, "ACTIVE", json({}), this.now().toISOString());
    });
    insert();
    return { id: grant.grantId, created: true };
  }

  persistChildCapability(childInput: GreenBannerChildCapability): { id: string; created: boolean } {
    const child = GreenBannerChildCapabilitySchema.parse(childInput);
    assertGreenBannerChildDigest(child);
    const parent = this.sqlite
      .prepare("SELECT grant_digest AS grantDigest FROM green_banner_parent_grants WHERE id=?")
      .get(child.parentGrantId) as { grantDigest: string } | undefined;
    if (!parent || parent.grantDigest !== child.parentGrantDigest)
      throw new Error("PARENT_GRANT_NOT_CURRENT");
    const parentState = this.latestParentState(child.parentGrantId);
    if (parentState !== "ACTIVE") throw new Error("PARENT_GRANT_NOT_ACTIVE");
    const existing = this.sqlite
      .prepare(
        "SELECT id,parent_grant_digest AS parentGrantDigest FROM green_banner_child_capabilities WHERE child_digest=?",
      )
      .get(child.childDigest) as { id: string; parentGrantDigest: string } | undefined;
    if (existing) {
      if (existing.parentGrantDigest !== child.parentGrantDigest)
        throw new Error("CHILD_PARENT_CONFLICT");
      return { id: existing.id, created: false };
    }
    const insert = this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO green_banner_child_capabilities
           (id,parent_grant_id,parent_grant_digest,child_digest,child_type,operation,scope_json,main_sha,created_at,expires_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          child.childId,
          child.parentGrantId,
          child.parentGrantDigest,
          child.childDigest,
          child.childType,
          child.operation,
          json(child),
          child.mainSha,
          child.createdAt,
          child.expiresAt,
        );
      this.sqlite
        .prepare(
          `INSERT INTO green_banner_child_events
           (id,child_capability_id,sequence,state,safe_metadata_json,occurred_at)
           VALUES (?,?,?,?,?,?)`,
        )
        .run(this.id(), child.childId, 0, "ACTIVE", json({}), this.now().toISOString());
    });
    insert();
    return { id: child.childId, created: true };
  }

  transitionChild(childId: string, state: Exclude<ChildEventState, "ACTIVE">): void {
    const current = this.sqlite
      .prepare(
        `SELECT e.sequence,e.state,c.expires_at AS expiresAt
         FROM green_banner_child_events e JOIN green_banner_child_capabilities c ON c.id=e.child_capability_id
         WHERE e.child_capability_id=? ORDER BY e.sequence DESC LIMIT 1`,
      )
      .get(childId) as { sequence: number; state: ChildEventState; expiresAt: string } | undefined;
    if (!current) throw new Error("CHILD_CAPABILITY_NOT_FOUND");
    if (current.state !== "ACTIVE") throw new Error("CHILD_CAPABILITY_TERMINAL");
    if (state !== "CONSUMED" && state !== "REVOKED" && state !== "EXPIRED") {
      throw new Error("CHILD_STATE_INVALID");
    }
    this.sqlite
      .prepare(
        `INSERT INTO green_banner_child_events
         (id,child_capability_id,sequence,state,safe_metadata_json,occurred_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(this.id(), childId, current.sequence + 1, state, json({}), this.now().toISOString());
  }

  transitionParent(state: Exclude<ParentEventState, "ACTIVE">): void {
    const parentId = "GREEN_BANNER_SESSION_GRANT_V1";
    const current = this.latestParentState(parentId);
    if (current !== "ACTIVE") throw new Error("PARENT_GRANT_TERMINAL");
    const row = this.sqlite
      .prepare(
        "SELECT max(sequence) AS sequence FROM green_banner_parent_grant_events WHERE parent_grant_id=?",
      )
      .get(parentId) as { sequence: number | null };
    this.sqlite
      .prepare(
        `INSERT INTO green_banner_parent_grant_events
         (id,parent_grant_id,sequence,state,safe_metadata_json,occurred_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        this.id(),
        parentId,
        (row.sequence ?? -1) + 1,
        state,
        json({}),
        this.now().toISOString(),
      );
  }

  latestParentState(parentId = "GREEN_BANNER_SESSION_GRANT_V1"): ParentEventState {
    const row = this.sqlite
      .prepare(
        "SELECT state FROM green_banner_parent_grant_events WHERE parent_grant_id=? ORDER BY sequence DESC LIMIT 1",
      )
      .get(parentId) as { state: ParentEventState } | undefined;
    if (!row) throw new Error("PARENT_GRANT_NOT_FOUND");
    return row.state;
  }

  getParentGrant(parentId = "GREEN_BANNER_SESSION_GRANT_V1"): GreenBannerParentGrant {
    const row = this.sqlite
      .prepare(
        `SELECT id,grant_type AS grantType,grant_digest AS grantDigest,
                allowed_operations_json AS allowedOperationsJson,scope_json AS scopeJson,
                main_sha AS mainSha,created_at AS createdAt
         FROM green_banner_parent_grants WHERE id=?`,
      )
      .get(parentId) as
      | {
          id: string;
          grantType: string;
          grantDigest: string;
          allowedOperationsJson: string;
          scopeJson: string;
          mainSha: string;
          createdAt: string;
        }
      | undefined;
    if (!row) throw new Error("PARENT_GRANT_NOT_FOUND");
    return GreenBannerParentGrantSchema.parse({
      schemaVersion: 1,
      grantId: row.id,
      grantType: row.grantType,
      grantDigest: row.grantDigest,
      allowedOperations: JSON.parse(row.allowedOperationsJson),
      scope: JSON.parse(row.scopeJson),
      mainSha: row.mainSha,
      createdAt: row.createdAt,
    });
  }

  latestChildState(childId: string): ChildEventState {
    const row = this.sqlite
      .prepare(
        "SELECT state FROM green_banner_child_events WHERE child_capability_id=? ORDER BY sequence DESC LIMIT 1",
      )
      .get(childId) as { state: ChildEventState } | undefined;
    if (!row) throw new Error("CHILD_CAPABILITY_NOT_FOUND");
    return row.state;
  }
}
