import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  currentR2EvaluationVersions,
  r2CurrentEvaluationSql,
  r2EvaluationVersionsAreCurrent,
} from "./r2-evaluation-currentness";

describe("installed R2 evaluation version binding", () => {
  it("accepts exactly the installed tuple and fails closed for absent fields", () => {
    const current = currentR2EvaluationVersions();
    expect(r2EvaluationVersionsAreCurrent(current)).toBe(true);
    for (const key of Object.keys(current)) {
      const missing: Partial<typeof current> = { ...current };
      delete missing[key as keyof typeof missing];
      expect(r2EvaluationVersionsAreCurrent(missing)).toBe(false);
      expect(r2EvaluationVersionsAreCurrent({ ...current, [key]: null })).toBe(false);
    }
    expect(r2EvaluationVersionsAreCurrent(null)).toBe(false);
    expect(r2EvaluationVersionsAreCurrent(undefined)).toBe(false);
  });
  it.each(Object.keys(currentR2EvaluationVersions()))(
    "rejects independent %s drift in JS and SQL",
    (key) => {
      const versions = currentR2EvaluationVersions(),
        sqlite = new BetterSqlite3(":memory:");
      try {
        sqlite.exec(
          "CREATE TABLE evaluations(evidence_contract_version,normalization_version,coverage_version,eligibility_engine_version,fit_scorer_version,weight_version)",
        );
        sqlite
          .prepare("INSERT INTO evaluations VALUES (?,?,?,?,?,?)")
          .run(...Object.values(versions));
        const query = () =>
          sqlite
            .prepare(`SELECT ${r2CurrentEvaluationSql()} AS current FROM evaluations e`)
            .pluck()
            .get();
        expect(query()).toBe(1);
        expect(r2EvaluationVersionsAreCurrent({ ...versions, [key]: "historical" })).toBe(false);
        const columns = {
          evidenceContractVersion: "evidence_contract_version",
          normalizationVersion: "normalization_version",
          coverageVersion: "coverage_version",
          eligibilityEngineVersion: "eligibility_engine_version",
          scorerVersion: "fit_scorer_version",
          weightVersion: "weight_version",
        };
        const column = columns[key as keyof typeof columns];
        sqlite.prepare(`UPDATE evaluations SET ${column}=?`).run("historical");
        expect(query()).toBe(0);
        sqlite.prepare(`UPDATE evaluations SET ${column}=NULL`).run();
        expect(query()).toBe(0);
      } finally {
        sqlite.close();
      }
    },
  );
});
