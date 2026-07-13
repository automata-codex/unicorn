import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type SystemSlug = 'mothership';

export interface WardenPromptFile {
  filename: string;
  hash: string;
  text: string;
}

/**
 * Walks up from `dir` to the nearest ancestor containing `package.json` —
 * the `apps/zoltar-be` package root, regardless of whether this module is
 * running from `src/` (tsx, vitest) or from a compiled `dist/src/` (nest
 * start/build). Nest's build doesn't copy non-`.ts` assets into `dist/`,
 * so anchoring on `__dirname` directly breaks under a compiled runtime.
 */
function findPackageRoot(dir: string): string {
  let current = dir;
  while (!existsSync(join(current, 'package.json'))) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate package.json above ${dir}`);
    }
    current = parent;
  }
  return current;
}

/**
 * Resolves to `apps/zoltar-be/src/wardens/prompts` always — regardless of
 * whether the calling code is running from `src/` or a compiled `dist/`.
 *
 * `WARDENS_PROMPTS_DIR` overrides the path when set — test-only hook
 * used by fixtures that point discovery at a temp directory.
 */
export function promptsDir(): string {
  const override = process.env.WARDENS_PROMPTS_DIR;
  if (override && override.length > 0) return override;
  return join(findPackageRoot(__dirname), 'src', 'wardens', 'prompts');
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
