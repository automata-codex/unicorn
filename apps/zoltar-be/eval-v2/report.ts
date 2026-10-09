/**
 * `task ev2:report` — tallies the hand-marked `marks.csv` of one run and
 * prints, per case, how many reps were right against the bar. Reads files
 * only: no database, no Anthropic.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BAR = 0.9;

const MARKS = ['pass', 'fail', 'na', 'error'] as const;
export type Mark = (typeof MARKS)[number];

export interface MarkedRow {
  fixtureId: string;
  rep: string;
  mark: Mark;
  note: string;
}

export interface MarksFile {
  /** The rubric the marks were made under; null when the line is absent or blank. */
  rubric: string | null;
  rows: MarkedRow[];
}

const HEADER = 'fixture,rep,mark,note';
const RUBRIC_LINE = /^#\s*rubric:(.*)$/i;

/**
 * Each row is split on its first three commas, so a note may contain commas.
 * Refuses a file with unmarked rows rather than report a partial rate.
 *
 * The file may open with a `# rubric: v1` line, above the header (spec 027).
 */
export function parseMarks(text: string): MarksFile {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const rubricMatch = RUBRIC_LINE.exec(lines[0] ?? '');
  const rubric = rubricMatch?.[1].trim() || null;
  // Row numbers in errors count from the top of the file, rubric line included.
  const headerAt = rubricMatch ? 1 : 0;

  if (lines[headerAt] !== HEADER) {
    throw new Error(
      `marks file must start with the header "${HEADER}", after an optional "# rubric:" line`,
    );
  }

  const rows: MarkedRow[] = [];
  let unmarked = 0;

  for (const [index, line] of lines.slice(headerAt + 1).entries()) {
    const [fixtureId, rep, rawMark, ...rest] = line.split(',');
    const where = `row ${index + headerAt + 2} (${fixtureId} rep ${rep})`;
    if (rawMark === undefined) {
      throw new Error(`${where}: expected fixture,rep,mark,note`);
    }

    const mark = rawMark.trim().toLowerCase();
    if (mark === '') {
      unmarked++;
      continue;
    }
    if (!(MARKS as readonly string[]).includes(mark)) {
      throw new Error(
        `${where}: unknown mark "${rawMark}" — use pass, fail or na`,
      );
    }

    rows.push({ fixtureId, rep, mark: mark as Mark, note: rest.join(',') });
  }

  if (unmarked > 0) {
    throw new Error(
      `${unmarked} row(s) are not marked yet — fill in pass, fail or na`,
    );
  }
  return { rubric, rows };
}

export interface CaseTally {
  fixtureId: string;
  pass: number;
  fail: number;
  na: number;
  error: number;
  /** `pass / (pass + fail)`; null when no rep made a checkable claim. */
  rate: number | null;
  meetsBar: boolean;
}

export function tally(rows: MarkedRow[]): CaseTally[] {
  const byCase = new Map<string, Record<Mark, number>>();
  for (const row of rows) {
    const counts = byCase.get(row.fixtureId) ?? {
      pass: 0,
      fail: 0,
      na: 0,
      error: 0,
    };
    counts[row.mark]++;
    byCase.set(row.fixtureId, counts);
  }

  return [...byCase].map(([fixtureId, counts]) => {
    // `na` and `error` stay out of the fraction: a rep that said nothing
    // checkable, or never finished, is not evidence either way.
    const judged = counts.pass + counts.fail;
    const rate = judged === 0 ? null : counts.pass / judged;
    return {
      fixtureId,
      ...counts,
      rate,
      meetsBar: rate !== null && rate >= BAR,
    };
  });
}

export function renderReport(
  tallies: CaseTally[],
  rubric: string | null = null,
): string {
  const width = Math.max(4, ...tallies.map((t) => t.fixtureId.length));
  const row = (cells: string[]): string =>
    [cells[0].padEnd(width), ...cells.slice(1).map((c) => c.padStart(6))].join(
      '  ',
    );

  const lines = [
    ...(rubric === null ? [] : [`rubric ${rubric}`, '']),
    row(['case', 'pass', 'fail', 'na', 'error', 'rate', 'bar']),
    ...tallies.map((t) =>
      row([
        t.fixtureId,
        String(t.pass),
        String(t.fail),
        String(t.na),
        String(t.error),
        t.rate === null ? '—' : t.rate.toFixed(2),
        t.meetsBar ? 'met' : 'NOT',
      ]),
    ),
  ];

  const missed = tallies.filter((t) => !t.meetsBar).map((t) => t.fixtureId);
  lines.push(
    '',
    missed.length === 0
      ? `Every case meets the ${BAR.toFixed(2)} bar.`
      : `Below the ${BAR.toFixed(2)} bar: ${missed.join(', ')}`,
  );
  return lines.join('\n');
}

/** Accepts a path to a run directory, or a bare run id under the eval root. */
export function resolveRunDir(arg: string): string {
  if (existsSync(arg)) return arg;
  const root = process.env.ZOLTAR_EVAL_ROOT;
  const underRoot = root ? join(root, 'eval-v2-runs', arg) : null;
  if (underRoot && existsSync(underRoot)) return underRoot;
  throw new Error(`run directory not found: ${arg}`);
}

function main(): void {
  const [arg] = process.argv.slice(2);
  if (!arg) throw new Error('Usage: task ev2:report -- <run-dir>');

  const marksPath = join(resolveRunDir(arg), 'marks.csv');
  if (!existsSync(marksPath)) {
    throw new Error(
      `${marksPath} does not exist — the run did not finish, so there is nothing to report.`,
    );
  }
  const { rubric, rows } = parseMarks(readFileSync(marksPath, 'utf8'));
  console.log(renderReport(tally(rows), rubric));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
