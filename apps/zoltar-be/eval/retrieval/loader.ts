import { readFile } from 'node:fs/promises';

import {
  type RetrievalFixture,
  retrievalFixtureSchema,
} from './fixture.schema';

/**
 * JSONL, one fixture per line, at
 * `apps/zoltar-be/eval/retrieval-fixtures/<system>.jsonl`.
 *
 * **Deliberately not under `eval/fixtures/`.** `computeCorpusVersion` hashes
 * every `.json` file in that directory (`eval/corpus-version.ts`), so a
 * retrieval fixture landing there would change the Warden corpus version and
 * trigger `eval:compare`'s cross-corpus warning on unrelated M7.4 runs.
 * JSONL gives a second layer of protection since that glob is `.json`, but
 * the directory separation is the real one — do not rely on the extension, in
 * case someone later makes the hash recursive or extension-agnostic.
 */
export class FixtureLoadError extends Error {}

export function parseFixtureLines(
  text: string,
  origin: string,
): RetrievalFixture[] {
  const fixtures: RetrievalFixture[] = [];
  const seen = new Map<string, number>();

  const lines = text.split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;

    const lineNumber = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new FixtureLoadError(
        `${origin}:${lineNumber} is not valid JSON: ${(err as Error).message}`,
      );
    }

    const result = retrievalFixtureSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map(
          (issue) =>
            `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
        )
        .join('\n');
      throw new FixtureLoadError(
        `${origin}:${lineNumber} is not a valid retrieval fixture:\n${issues}`,
      );
    }

    const previous = seen.get(result.data.id);
    if (previous !== undefined) {
      // Duplicate ids would double-count one query in every rate and make the
      // per-fixture rows ambiguous to join on.
      throw new FixtureLoadError(
        `${origin}:${lineNumber} reuses fixture id "${result.data.id}", first seen on line ${previous}`,
      );
    }
    seen.set(result.data.id, lineNumber);
    fixtures.push(result.data);
  }

  return fixtures;
}

export async function loadFixtures(
  path: string,
  options: { system?: string } = {},
): Promise<RetrievalFixture[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new FixtureLoadError(
      `could not read fixture file ${path}: ${(err as Error).message}`,
    );
  }

  const all = parseFixtureLines(text, path);
  if (options.system === undefined) return all;
  return all.filter((fixture) => fixture.system === options.system);
}
