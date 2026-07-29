import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface FixtureFileEntry {
  filename: string;
  id: string;
  bytes: Buffer;
}

/**
 * SHA-256 over every fixture file's raw bytes, concatenated in `id` sort
 * order (filename as tie-break). Raw bytes, not re-serialized parsed JSON —
 * a whitespace-only edit still changes the version, because the point is
 * detecting "different fixtures," and a normalizing hash would quietly
 * decide some differences don't count.
 *
 * Ordering by `id` (not filename or `readdir` order) is what makes the hash
 * stable under a rename that doesn't change content, and what makes it
 * portable across filesystems with different directory-iteration order.
 *
 * A file that fails to parse, or has no string `id`, is a hard error here
 * rather than a skip — a corpus hash that silently omits a broken file is
 * worse than no hash.
 */
export async function computeCorpusVersion(
  fixturesDir: string,
): Promise<string> {
  const entries = await readdir(fixturesDir, { withFileTypes: true });
  const jsonFilenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  const files: FixtureFileEntry[] = [];
  for (const filename of jsonFilenames) {
    const bytes = await readFile(join(fixturesDir, filename));

    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf-8'));
    } catch (err) {
      throw new Error(
        `corpus hash: "${filename}" is not valid JSON: ${(err as Error).message}`,
      );
    }

    const id = (parsed as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`corpus hash: "${filename}" has no string "id" field`);
    }

    files.push({ filename, id, bytes });
  }

  files.sort(
    (a, b) => a.id.localeCompare(b.id) || a.filename.localeCompare(b.filename),
  );

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}

/** First 12 hex chars, for report headers. The full hash goes on every row. */
export function shortCorpusVersion(hash: string): string {
  return hash.slice(0, 12);
}
