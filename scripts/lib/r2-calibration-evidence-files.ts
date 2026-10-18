import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const fail = (): never => {
  throw new Error("R2_CALIBRATION_SAFETY_FILES_INVALID");
};
function targetPath(rootInput: string, path: string): { root: string; target: string } {
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  )
    return fail();
  const root = resolve(rootInput),
    target = resolve(root, path),
    inside = relative(root, target);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
    return fail();
  return { root, target };
}
function directory(path: string): Stats {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(path) !== resolve(path)) return fail();
  return s;
}
function ancestors(root: string, target: string): Array<{ path: string; stat: Stats }> {
  const rows = [{ path: root, stat: directory(root) }];
  let current = root;
  for (const part of relative(root, dirname(target)).split(sep).filter(Boolean)) {
    current = join(current, part);
    rows.push({ path: current, stat: directory(current) });
  }
  return rows;
}
function same(a: Stats, b: Stats, content = false): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.nlink === b.nlink &&
    (!content || (a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs))
  );
}
function verifyAncestors(rows: Array<{ path: string; stat: Stats }>): void {
  for (const row of rows) if (!same(row.stat, directory(row.path))) fail();
}
function regular(path: string, limit: number): Stats {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit)
    return fail();
  return stat;
}
/** Descriptor-bound capped reads, with physical ancestors and pre/post identity checks. */
export function readCalibrationEvidenceFile(
  rootInput: string,
  path: string,
  limit: number,
): Buffer {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20_000_000) return fail();
  const { root, target } = targetPath(rootInput, path),
    parents = ancestors(root, target),
    before = regular(target, limit);
  const fd = openSync(
    /* turbopackIgnore: true */ target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || !same(before, opened, true)) return fail();
    const chunks: Buffer[] = [];
    let length = 0;
    while (length <= limit) {
      const chunk = Buffer.allocUnsafe(Math.min(65_536, limit + 1 - length));
      const count = readSync(fd, chunk, 0, chunk.length, length);
      if (count === 0) break;
      length += count;
      if (length > limit) return fail();
      chunks.push(chunk.subarray(0, count));
    }
    const after = fstatSync(fd),
      pathAfter = regular(target, limit);
    verifyAncestors(parents);
    if (
      !same(opened, after, true) ||
      !same(after, pathAfter, true) ||
      after.size !== length ||
      realpathSync(target) !== target
    )
      return fail();
    return Buffer.concat(chunks, length);
  } finally {
    closeSync(fd);
  }
}
/** Create one owned component at a time; reject a preexisting reparse path before output. */
export function createCalibrationEvidenceDirectory(rootInput: string, path: string): void {
  if (!/^data\/private\/runtime\/r2-calibration-safety\/[a-f0-9]{40}\/[a-f0-9-]{36}$/.test(path))
    return fail();
  const { root } = targetPath(rootInput, path);
  directory(root);
  let current = root;
  for (const part of path.split("/")) {
    directory(current);
    current = join(current, part);
    if (!existsSync(/* turbopackIgnore: true */ current)) mkdirSync(current, { mode: 0o700 });
    directory(current);
  }
}
export function writeCalibrationEvidenceFile(
  rootInput: string,
  path: string,
  body: string | Buffer,
): void {
  if (
    !/^data\/private\/runtime\/r2-calibration-safety\/[a-f0-9]{40}\/[a-f0-9-]{36}\/[a-z0-9.-]+$/.test(
      path,
    )
  )
    return fail();
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (bytes.length > 20_000_000) return fail();
  const { root, target } = targetPath(rootInput, path),
    parents = ancestors(root, target);
  const fd = openSync(
    target,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    const opened = fstatSync(fd);
    verifyAncestors(parents);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      !same(opened, lstatSync(target)) ||
      realpathSync(target) !== target
    )
      return fail();
    writeFileSync(fd, bytes);
    verifyAncestors(parents);
    const after = fstatSync(fd);
    if (after.nlink !== 1 || after.size !== bytes.length || !same(after, lstatSync(target), true))
      return fail();
  } finally {
    closeSync(fd);
  }
}
export function installCurrentCalibrationEvidence(rootInput: string, temporaryPath: string): void {
  if (
    !/^data\/private\/runtime\/r2-calibration-safety\/[a-f0-9]{40}\/[a-f0-9-]{36}\/current\.tmp$/.test(
      temporaryPath,
    )
  )
    return fail();
  const destination = "data/private/runtime/r2-calibration-safety.json";
  const { root, target } = targetPath(rootInput, temporaryPath),
    parents = ancestors(root, target),
    final = targetPath(root, destination).target,
    finalParents = ancestors(root, final);
  regular(target, 1_000_000);
  if (existsSync(/* turbopackIgnore: true */ final)) regular(final, 1_000_000);
  verifyAncestors(parents);
  verifyAncestors(finalParents);
  renameSync(target, final);
  verifyAncestors(finalParents);
  regular(final, 1_000_000);
}
