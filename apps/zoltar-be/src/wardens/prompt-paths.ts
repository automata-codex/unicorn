import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type SystemSlug = 'mothership';

export interface WardenPromptFile {
  filename: string;
  hash: string;
  text: string;
}

/**
 * Resolves to `apps/zoltar-be/src/wardens/prompts`. Nest compiles to
 * `dist/` during `build`, but the repo's runtime paths (vitest, `tsx`,
 * nest in dev) all execute against `src/` directly — verified against the
 * db, config, and voyage modules which use the same `__dirname` anchoring
 * pattern without a dist/src switch. If a future production build lands
 * that runs from `dist/`, the prompts will need to be copied alongside
 * (Nest's `assets` in nest-cli.json) or this helper anchored to `src/`
 * via a repo marker instead.
 *
 * `WARDENS_PROMPTS_DIR` overrides the path when set — test-only hook
 * used by fixtures that point discovery at a temp directory.
 */
export function promptsDir(): string {
  const override = process.env.WARDENS_PROMPTS_DIR;
  if (override && override.length > 0) return override;
  return resolve(__dirname, 'prompts');
}

export function hashPromptText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

/**
 * Reads the current on-disk content of a prompt file and re-hashes it.
 * Used by the review CLI to detect in-place edits that happened after
 * telemetry was written. Returns null if the file no longer exists.
 */
export function rereadPromptFile(
  system: SystemSlug,
  filename: string,
): WardenPromptFile | null {
  if (!filename.startsWith(`${system}-`) || !filename.endsWith('.txt')) {
    return null;
  }
  try {
    const text = readFileSync(join(promptsDir(), filename), 'utf8');
    return { filename, hash: hashPromptText(text), text };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
