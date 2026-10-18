import "server-only";
import type BetterSqlite3 from "better-sqlite3";
import {
  assertCurrentCalibrationQualification,
  readR2CalibrationProfile,
} from "@applypilot/database";
import type { ValidatedR2CalibrationSafety } from "@applypilot/fit-scorer";
import {
  readCurrentR2CalibrationProfileHash,
  readCurrentR2CalibrationSafety,
} from "../../../scripts/lib/r2-calibration-safety";

/** Current-facing metadata only. This never changes recommendation or grants preparation permission. */
export function createCurrentR2CalibrationStatusReader(
  sqlite: BetterSqlite3.Database,
  root: string,
): (runId: string | null | undefined) => boolean {
  let context:
    | { profileVersionId: string; profileHash: string; safety: ValidatedR2CalibrationSafety }
    | null
    | undefined;
  const results = new Map<string, boolean>();
  return (runId) => {
    if (!runId) return false;
    if (results.has(runId)) return results.get(runId)!;
    if (context === undefined) {
      try {
        const profile = readR2CalibrationProfile(sqlite, readCurrentR2CalibrationProfileHash(root));
        context = {
          profileVersionId: profile.profileVersionId,
          profileHash: profile.profileHash,
          safety: readCurrentR2CalibrationSafety(root),
        };
      } catch {
        context = null;
      }
    }
    let current = false;
    if (context) {
      try {
        assertCurrentCalibrationQualification(sqlite, {
          runId,
          expectedEngine: context.safety.bundle.engine,
          profileVersionId: context.profileVersionId,
          profileHash: context.profileHash,
          safetyEvidence: context.safety,
        });
        current = true;
      } catch {
        /* Historical calibration metadata is retained; unavailable current evidence grants no badge. */
      }
    }
    results.set(runId, current);
    return current;
  };
}
