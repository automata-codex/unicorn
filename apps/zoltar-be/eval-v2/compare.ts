/**
 * `task ev2:compare` — puts two marked runs side by side: what differs between
 * them apart from the marks, each shared case's pass rate in both, and whether
 * the change is larger than the reps can produce by chance (spec 027). Reads
 * files and runs `git diff`: no database, no Anthropic.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { parseMarks, resolveRunDir, tally } from './report';

import type { CaseTally, MarkedRow } from './report';

/** A case is labeled only when chance would produce its split this rarely. */
export const ALPHA = 0.05;

const USAGE =
  'Usage: task ev2:compare -- <before>[,<run>...] <after>[,<run>...]';

/** What `ev2:run` writes to `run.json`, less what a comparison does not use. */
const runInfoSchema = z.object({
  runId: z.string().min(1),
  question: z.string().min(1),
  commit: z.string().min(1),
  dirty: z.boolean(),
  prompt: z.object({ filename: z.string(), hash: z.string() }),
});

export type RunInfo = z.infer<typeof runInfoSchema>;

export interface LoadedRun {
  info: RunInfo;
  rubric: string | null;
  rows: MarkedRow[];
}

export type SideName = 'before' | 'after';

/** One side of the comparison: a run, or several pooled as one. */
export interface Side {
  name: SideName;
  /** The run id is the run's UTC start time, so this also dates the side. */
  runIds: string[];
  question: string;
  commit: string;
  dirty: boolean;
  prompt: RunInfo['prompt'];
  rubric: string;
  rows: MarkedRow[];
}

export function parseArgs(argv: string[]): Record<SideName, string[]> {
  if (argv.length !== 2) throw new Error(USAGE);
  const [before, after] = argv.map((arg) =>
    arg
      .split(',')
      .map((run) => run.trim())
      .filter((run) => run !== ''),
  );
  if (before.length === 0 || after.length === 0) throw new Error(USAGE);
  return { before, after };
}

/**
 * Pools the runs of one side. A top-up run only adds reps to the run it tops
 * up, so the runs must agree on everything a result depends on.
 */
export function poolSide(name: SideName, runs: LoadedRun[]): Side {
  for (const run of runs) {
    if (run.rubric === null) {
      throw new Error(
        `${name}: run ${run.info.runId} records no rubric version — add "# rubric: vN" as the first line of its marks.csv`,
      );
    }
  }

  const shared = (what: string, values: string[]): string => {
    const distinct = [...new Set(values)];
    if (distinct.length > 1) {
      throw new Error(
        `${name}: pooled runs must share a ${what}; found ${distinct.join(', ')}`,
      );
    }
    return distinct[0];
  };

  const question = shared(
    'question',
    runs.map((r) => r.info.question),
  );
  const commit = shared(
    'commit',
    runs.map((r) => r.info.commit),
  );
  const hash = shared(
    'prompt hash',
    runs.map((r) => r.info.prompt.hash),
  );
  const rubric = shared(
    'rubric version',
    runs.map((r) => r.rubric ?? ''),
  );

  return {
    name,
    runIds: runs.map((r) => r.info.runId),
    question,
    commit,
    dirty: runs.some((r) => r.info.dirty),
    prompt: { filename: runs[0].info.prompt.filename, hash },
    rubric,
    rows: runs.flatMap((r) => r.rows),
  };
}

interface Counts {
  pass: number;
  fail: number;
}

/** n choose k as a float, which is exact enough at the rep counts a run has. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

/**
 * Fisher's exact test, one-sided. Takes every pass and fail in the two runs
 * as given and deals them between the runs at random: the result is how often
 * `higher` would end up with at least as many passes as it has. Small means
 * the split is hard to get from two runs with one underlying pass rate.
 */
export function fisherOneSided(lower: Counts, higher: Counts): number {
  const nLower = lower.pass + lower.fail;
  const nHigher = higher.pass + higher.fail;
  const passes = lower.pass + higher.pass;

  let atLeast = 0;
  for (let k = higher.pass; k <= Math.min(nHigher, passes); k++) {
    atLeast += choose(nHigher, k) * choose(nLower, passes - k);
  }
  return Math.min(1, atLeast / choose(nLower + nHigher, passes));
}

export type Label = 'improved' | 'worse' | 'not shown';

export interface CaseComparison {
  fixtureId: string;
  before: CaseTally;
  after: CaseTally;
  /** Null when there is no direction to test: equal rates, or a side with no rate. */
  chance: number | null;
  label: Label;
}

export function compareCase(
  before: CaseTally,
  after: CaseTally,
): CaseComparison {
  const base = { fixtureId: before.fixtureId, before, after };
  if (
    before.rate === null ||
    after.rate === null ||
    before.rate === after.rate
  ) {
    return { ...base, chance: null, label: 'not shown' };
  }

  const better = after.rate > before.rate;
  const chance = better
    ? fisherOneSided(before, after)
    : fisherOneSided(after, before);
  const shown = chance <= ALPHA;
  return {
    ...base,
    chance,
    label: shown ? (better ? 'improved' : 'worse') : 'not shown',
  };
}

export interface Comparison {
  /** Cases in both sides, in the before side's order. */
  cases: CaseComparison[];
  onlyBefore: string[];
  onlyAfter: string[];
}

/** Refuses what cannot be compared, then compares the cases both sides have. */
export function compare(before: Side, after: Side): Comparison {
  if (before.question !== after.question) {
    throw new Error(
      `the runs answer different questions: ${before.question} and ${after.question}`,
    );
  }
  if (before.rubric !== after.rubric) {
    throw new Error(
      `the runs were marked under different rubrics: ${before.rubric} and ${after.rubric}. Re-mark one of them first.`,
    );
  }

  const beforeTallies = tally(before.rows);
  const afterTallies = new Map(tally(after.rows).map((t) => [t.fixtureId, t]));

  const cases: CaseComparison[] = [];
  const onlyBefore: string[] = [];
  for (const t of beforeTallies) {
    const match = afterTallies.get(t.fixtureId);
    if (match) cases.push(compareCase(t, match));
    else onlyBefore.push(t.fixtureId);
    afterTallies.delete(t.fixtureId);
  }

  if (cases.length === 0) {
    throw new Error('the runs have no case in common');
  }
  return { cases, onlyBefore, onlyAfter: [...afterTallies.keys()] };
}

/** The files `git diff` named, or the commit that could not be found. */
export type ChangedFiles = string[] | { missingCommit: string };

/** Test files change no behavior, so they are left out of the file list. */
export function isTestFile(path: string): boolean {
  return (
    /\.(spec|test|spec-int)\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)test\//.test(path)
  );
}

const short = (commit: string): string => commit.slice(0, 7);

function renderTable(rows: string[][]): string[] {
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((cells) => cells[col].length)),
  );
  return rows.map((cells) =>
    cells
      .map((cell, col) => cell.padEnd(widths[col]))
      .join('  ')
      .trimEnd(),
  );
}

function renderDifferences(
  before: Side,
  after: Side,
  files: ChangedFiles,
  comparison: Comparison,
): string[] {
  const lines: string[] = [];

  lines.push(
    before.prompt.hash === after.prompt.hash
      ? `Prompt unchanged: ${before.prompt.filename} ${before.prompt.hash}`
      : `Prompt changed: ${before.prompt.filename} ${before.prompt.hash} → ${after.prompt.filename} ${after.prompt.hash}`,
  );

  const dirty = [before, after].filter((s) => s.dirty).map((s) => s.name);
  if (dirty.length > 0) {
    lines.push(`Run from a dirty tree: ${dirty.join(', ')}`);
  }

  if (!Array.isArray(files)) {
    lines.push(
      `File list left out: commit ${short(files.missingCommit)} is not in this repository.`,
    );
  } else if (before.commit === after.commit) {
    lines.push(`Same commit: ${short(before.commit)}`);
  } else if (files.length === 0) {
    lines.push(
      `No files changed between ${short(before.commit)} and ${short(after.commit)}, tests aside.`,
    );
  } else {
    lines.push(
      `Files changed between ${short(before.commit)} and ${short(after.commit)}:`,
      ...files.map((file) => `  ${file}`),
    );
  }

  if (comparison.onlyBefore.length > 0) {
    lines.push(`Only in before: ${comparison.onlyBefore.join(', ')}`);
  }
  if (comparison.onlyAfter.length > 0) {
    lines.push(`Only in after: ${comparison.onlyAfter.join(', ')}`);
  }
  return lines;
}

export function renderComparison(
  before: Side,
  after: Side,
  files: ChangedFiles,
  comparison: Comparison,
): string {
  const header = renderTable(
    [before, after].map((side) => [
      side.name,
      side.runIds.join(','),
      `${short(side.commit)}${side.dirty ? ' dirty' : ''}`,
      `${side.prompt.filename} ${side.prompt.hash}`,
      `rubric ${side.rubric}`,
    ]),
  );

  const counts = (t: CaseTally): string =>
    `${t.pass}/${t.pass + t.fail}  ${t.rate === null ? '—' : t.rate.toFixed(2)}`;

  const table = renderTable([
    ['case', 'before', 'after', 'bar (after)', 'change'],
    ...comparison.cases.map((c) => [
      c.fixtureId,
      counts(c.before),
      counts(c.after),
      c.after.meetsBar ? 'met' : 'NOT',
      c.chance === null ? c.label : `${c.label} (${c.chance.toFixed(2)})`,
    ]),
  ]);

  return [
    ...header,
    '',
    ...renderDifferences(before, after, files, comparison),
    '',
    ...table,
  ].join('\n');
}

function loadRun(arg: string): LoadedRun {
  const dir = resolveRunDir(arg);
  const marksPath = join(dir, 'marks.csv');
  if (!existsSync(marksPath)) {
    throw new Error(
      `${marksPath} does not exist — the run did not finish, so there is nothing to compare.`,
    );
  }
  const info = runInfoSchema.parse(
    JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')),
  );
  return { info, ...parseMarks(readFileSync(marksPath, 'utf8')) };
}

function git(...args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function hasCommit(commit: string): boolean {
  try {
    git('cat-file', '-e', `${commit}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Everything under the backend and the shared packages, not only what looks
 * like it reaches the Warden: which files matter is the reader's call.
 */
function changedFiles(before: string, after: string): ChangedFiles {
  if (before === after) return [];
  for (const commit of [before, after]) {
    if (!hasCommit(commit)) return { missingCommit: commit };
  }
  return git(
    'diff',
    '--name-only',
    before,
    after,
    '--',
    ':/apps/zoltar-be',
    ':/packages',
  )
    .split('\n')
    .filter((file) => file !== '' && !isTestFile(file));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const before = poolSide('before', args.before.map(loadRun));
  const after = poolSide('after', args.after.map(loadRun));
  const comparison = compare(before, after);
  const files = changedFiles(before.commit, after.commit);
  console.log(renderComparison(before, after, files, comparison));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
