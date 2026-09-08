import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const workspace = process.cwd();
const nextCli = resolve(workspace, "../../node_modules/next/dist/bin/next");
const result = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: workspace,
  env: {
    ...process.env,
    APPLYPILOT_DB_FILENAME: "applypilot.build-unavailable.sqlite",
    APPLYPILOT_PROFILE_FILENAME: "profile.build.private.json",
    APPLYPILOT_SYNTHETIC_MODE: "0",
  },
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
