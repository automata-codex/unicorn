import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { evalFixtureSchema } from './fixture.schema';

import type { EvalFixture, FailureModeTag } from './fixture.schema';

/**
 * One fixture file failing to parse or validate. Carries the filename and
 * every issue found (not just the first) so a fixture author sees the
 * whole problem in one pass.
 */
export class FixtureLoadError extends Error {
  constructor(
    public readonly filename: string,
    public readonly issues: string[],
  ) {
    super(`fixture file "${filename}" failed to load: ${issues.join('; ')}`);
    this.name = 'FixtureLoadError';
  }
}

export interface LoadFixturesOptions {
  /** If given, only fixtures whose `tag` is in this list are returned. */
  tags?: FailureModeTag[];
}

export interface LoadFixturesResult {
  fixtures: EvalFixture[];
  /**
   * One entry per file that failed to load. Never silently dropped — a
   * caller (the `eval:harness` CLI) decides whether an error here should
   * hard-fail the run or just be logged and continue with the fixtures
   * that did load. Errors are collected regardless of the `tags` filter,
   * since a broken fixture file is worth reporting even if its tag
   * wouldn't have been selected.
   */
  errors: FixtureLoadError[];
}

/**
 * Loads every `*.json` file directly under `dir` (non-recursive — fixtures
 * are "one file per fixture" living flat in
 * `apps/zoltar-be/eval/fixtures/`), validating each against
 * `evalFixtureSchema`. A malformed file never aborts the whole load; it's
 * collected into `errors` and loading continues with the rest, since one
 * fixture author's typo shouldn't block running the other nineteen
 * fixtures. An empty or fixture-less directory returns an empty list
 * without erroring — the spec's fixture-count bar explicitly allows tags
 * with fewer than 2 (or 0) confirmed instances while coverage fills in.
 */
export async function loadFixtures(
  dir: string,
  opts: LoadFixturesOptions = {},
): Promise<LoadFixturesResult> {
  const entries = await readdir(dir, { withFileTypes: true });
  const jsonFilenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  const fixtures: EvalFixture[] = [];
  const errors: FixtureLoadError[] = [];

  for (const filename of jsonFilenames) {
    const raw = await readFile(join(dir, filename), 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      errors.push(
        new FixtureLoadError(filename, [
          `invalid JSON: ${(err as Error).message}`,
        ]),
      );
      continue;
    }

    const result = evalFixtureSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(
        (issue) =>
          `${issue.path.length ? issue.path.join('.') : '<root>'}: ${issue.message}`,
      );
      errors.push(new FixtureLoadError(filename, issues));
      continue;
    }

    fixtures.push(result.data);
  }

  const selected = opts.tags
    ? fixtures.filter((fixture) => opts.tags!.includes(fixture.tag))
    : fixtures;

  return { fixtures: selected, errors };
}
