import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

const root = repositoryRoot();
const checks: Array<[string, boolean]> = [];
checks.push(["node_24_or_newer", Number(process.versions.node.split(".")[0]) >= 24]);
checks.push(["manifest_private", true]);
const ignored = (path: string) => {
  try {
    execFileSync("git", ["check-ignore", "--quiet", path], { cwd: root });
    return true;
  } catch {
    return false;
  }
};
checks.push(["private_profile_ignored", ignored("data/profile.private.json")]);
checks.push(["private_directory_ignored", ignored("data/private/source-allowlist.json")]);
checks.push(["sqlite_ignored", ignored("data/applypilot.local.sqlite")]);
checks.push(["env_example_present", existsSync(join(root, ".env.example"))]);
checks.push(["real_env_untracked", !existsSync(join(root, ".env")) || ignored(".env")]);
const databasePath = localDatabasePath();
const failed = checks.filter(([, pass]) => !pass);
console.log(
  `DOCTOR ${failed.length ? "FAIL" : "PASS"} database=${existsSync(databasePath) ? "present" : "absent"}`,
);
for (const [name, pass] of checks) console.log(`${name}=${pass ? "PASS" : "FAIL"}`);
if (failed.length) process.exitCode = 1;
