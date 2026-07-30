import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * `git rev-parse --short HEAD` plus a `-dirty` suffix from `git status
 * --porcelain .` scoped to `apps/zoltar-be`, `unknown` on failure (e.g.
 * running outside a git checkout).
 *
 * Shared by `eval:run` and `eval:rescore` rather than duplicated: the two
 * commands write `harnessVersion` onto rows that are meant to be compared
 * against each other, so a divergence in how the value is derived — a
 * different `cwd`, a missing `-dirty` suffix — would show up as a phantom
 * "the checker changed" signal in exactly the comparison the field exists to
 * make honest.
 *
 * Meant to be called once per invocation, not per rep or per row: it shells
 * out twice, and the answer can't change mid-process.
 */
export function getHarnessVersion(): string {
  const packageRoot = join(__dirname, '..'); // apps/zoltar-be
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const statusOutput = execFileSync('git', ['status', '--porcelain', '.'], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return statusOutput.length > 0 ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}
