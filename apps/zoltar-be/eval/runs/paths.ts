import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Resolves `ZOLTAR_EVAL_ROOT` — an absolute path to the parent of
 * `eval-runs/`, which lives in the private `automata-codex` artifacts repo,
 * not this one. Deliberately not part of `src/config/env.schema.ts`: that
 * schema validates the *server's* boot-time environment, where every entry
 * is required; this is a CLI-only variable read at the eval-script boundary.
 *
 * Fails fast — unset, relative, or nonexistent are all caller mistakes worth
 * naming precisely rather than surfacing as an ENOENT three calls later.
 */
export function resolveEvalRoot(): string {
  const value = process.env.ZOLTAR_EVAL_ROOT;
  if (!value) {
    throw new Error(
      'ZOLTAR_EVAL_ROOT is not set. Set it in the repo-root .env to an ' +
        'absolute path — the parent of eval-runs/ in the private ' +
        'automata-codex artifacts repo.',
    );
  }
  if (!isAbsolute(value)) {
    throw new Error(
      `ZOLTAR_EVAL_ROOT must be an absolute path, got: "${value}"`,
    );
  }
  if (!existsSync(value) || !statSync(value).isDirectory()) {
    throw new Error(
      `ZOLTAR_EVAL_ROOT does not point at an existing directory: "${value}"`,
    );
  }
  return value;
}

/**
 * `<createdAt>` in the directory-name format: filename-safe ISO8601, second
 * precision. Colons are legal on APFS/ext4 but not on Windows and are
 * miserable to quote in a shell, so they're replaced with hyphens;
 * milliseconds are dropped as noise no one reads at this grain.
 */
function formatCreatedAt(createdAt: Date): string {
  return createdAt.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

/**
 * `<model>__<promptHash8>__<createdAt>` — a run directory's name. Directory
 * identity is `(model, promptHash)`; `createdAt` disambiguates directories
 * that would otherwise collide, and is passed in rather than computed here
 * so callers can inject a clock for deterministic tests (and so the same
 * timestamp can be reused for `manifest.createdAt`).
 */
export function runDirName(
  model: string,
  promptHash: string,
  createdAt: Date,
): string {
  return `${model}__${promptHash}__${formatCreatedAt(createdAt)}`;
}

/** `$ZOLTAR_EVAL_ROOT/eval-runs/<dirName>`. */
export function runDirPath(root: string, dirName: string): string {
  return join(root, 'eval-runs', dirName);
}

export function manifestPath(runDir: string): string {
  return join(runDir, 'manifest.json');
}

export function promptTextPath(runDir: string): string {
  return join(runDir, 'prompt.txt');
}

export function rubricPath(runDir: string, rubricHash: string): string {
  return join(runDir, 'rubrics', `${rubricHash}.txt`);
}

/** Zero-padded to 3 digits: `001`. Shared by `repDir` and error messages
 * that need to name a rep without building a full path. */
export function repDirName(index: number): string {
  return String(index).padStart(3, '0');
}

export function repDir(runDir: string, index: number): string {
  return join(runDir, 'reps', repDirName(index));
}

export function scoresPath(runDir: string, index: number): string {
  return join(repDir(runDir, index), 'scores.jsonl');
}

export function fixtureArtifactDir(
  runDir: string,
  index: number,
  fixtureId: string,
): string {
  return join(repDir(runDir, index), fixtureId);
}

export function judgeArtifactPath(
  runDir: string,
  index: number,
  fixtureId: string,
  checkId: string,
): string {
  return join(
    fixtureArtifactDir(runDir, index, fixtureId),
    `judge-${checkId}.json`,
  );
}

export function wardenRequestPath(
  runDir: string,
  index: number,
  fixtureId: string,
): string {
  return join(fixtureArtifactDir(runDir, index, fixtureId), 'warden-request.json');
}

export function wardenOutputPath(
  runDir: string,
  index: number,
  fixtureId: string,
): string {
  return join(fixtureArtifactDir(runDir, index, fixtureId), 'warden-output.json');
}

/**
 * The independent cross-check the spec calls for: rep directories that
 * exist on disk, regardless of what `manifest.json` vouches for. A crashed
 * rep leaves a directory here that `nextRepIndex` and `readVouchedRows`
 * both deliberately ignore — this is how `eval:report` can still name it.
 */
export function listRepDirsOnDisk(runDir: string): number[] {
  const repsDir = join(runDir, 'reps');
  if (!existsSync(repsDir)) return [];

  return readdirSync(repsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((a, b) => a - b);
}
