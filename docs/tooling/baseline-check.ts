#!/usr/bin/env tsx
/**
 * Reports eval runs that have never been dispositioned in
 * `docs/eval-methodology.md § Current baseline N`. See `baseline.core.ts` for
 * what the invariant is and why the obvious stronger one is wrong.
 *
 * Reads directory names under `$ZOLTAR_EVAL_ROOT/eval-runs` and one markdown
 * file. No database, no Anthropic, no Voyage, no cost — this is not an
 * `eval:*` script and needs no approval to run.
 *
 * **Skips cleanly when the archive is absent.** `ZOLTAR_EVAL_ROOT` points at a
 * local artifacts directory that is not in the repo and not present on a fresh
 * clone or in CI, so "cannot check" must exit 0. It is distinguished from
 * "checked and found nothing" in the output, because the two look identical to
 * anyone who stops reading at the exit code.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkBaselineDisposition } from './baseline.core';
import { DOCS_DIR } from './corpus';

const METHODOLOGY_PATH = join(DOCS_DIR, 'eval-methodology.md');

const evalRoot = process.env.ZOLTAR_EVAL_ROOT;
if (!evalRoot) {
  console.log(
    'baseline disposition: skipped — ZOLTAR_EVAL_ROOT is unset, so the run ' +
      'archive is not available to check against.',
  );
  process.exit(0);
}

const runsDir = join(evalRoot, 'eval-runs');
if (!existsSync(runsDir)) {
  console.log(`baseline disposition: skipped — no run archive at ${runsDir}.`);
  process.exit(0);
}

// A run is a directory carrying a manifest. The archive also holds rendered
// `.md` reports beside the directories they describe, and directories that
// never got far enough to write one.
const runIds = readdirSync(runsDir).filter((name) =>
  existsSync(join(runsDir, name, 'manifest.json')),
);

const result = checkBaselineDisposition({
  methodologyText: readFileSync(METHODOLOGY_PATH, 'utf8'),
  runIds,
});

switch (result.kind) {
  case 'unreadable':
    console.error(
      `baseline disposition check failed:\n\n  - ${result.problem}`,
    );
    process.exit(1);
    break;
  case 'undispositioned':
    console.error(
      `baseline disposition check failed — ${result.runs.length} run(s) are ` +
        'newer than the recorded standing point and are named nowhere in ' +
        'docs/eval-methodology.md:\n',
    );
    for (const run of result.runs) console.error(`  - ${run}`);
    console.error(
      `\n  standing point: ${result.standingPoint}\n\n` +
        '  Record each one in § Current baseline N. Accepting it as the new ' +
        'standing point means *replacing* that statement; a run that was not ' +
        'accepted still needs saying so, which is what makes this checkable.',
    );
    process.exit(1);
    break;
  case 'ok':
    console.log(
      `baseline disposition OK — standing point ${result.standingPoint}, ` +
        `${result.newerRuns} newer run(s), all accounted for.`,
    );
    break;
}
