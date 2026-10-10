/**
 * `task ev2:judge-check` — sets a judge's marks against the hand marks of the
 * same runs and prints where they disagree, against the two limits that say
 * whether the judge is usable (spec 028). Reads files only: no database, no
 * Anthropic.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { STARTS } from './judge.core';
import { parseMarks, resolveRunDir } from './report';

import type { Mark, MarkedRow } from './report';

/** The judge must give the hand mark on at least this share of pass/fail marks. */
export const AGREEMENT_LIMIT = 0.9;
/**
 * And may pass at most this many narrations the maintainer failed. Set for the
 * 114 marks of the 2026-10-09 runs, 76 of them fails.
 */
export const JUDGE_PASS_LIMIT = 4;

const USAGE =
  'Usage: task ev2:judge-check -- <run>[,<run>...] [--prompt <hash>]';

const JUDGE_LINE = /^#\s*judge:(.*)$/i;
const JUDGE_FILE = /^judge\.([0-9a-f]+)\.csv$/;

export interface CheckArgs {
  runs: string[];
  /** Which judge file to read when a run has more than one. */
  prompt: string | null;
}

export function parseArgs(argv: string[]): CheckArgs {
  const runs: string[] = [];
  let prompt: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--prompt') {
      prompt = argv[++i] ?? null;
      if (prompt === null) throw new Error(USAGE);
    } else if (argv[i].startsWith('--')) {
      throw new Error(`unknown argument "${argv[i]}". ${USAGE}`);
    } else {
      runs.push(
        ...argv[i]
          .split(',')
          .map((run) => run.trim())
          .filter((run) => run !== ''),
      );
    }
  }
  if (runs.length === 0) throw new Error(USAGE);
  return { runs, prompt };
}

export interface JudgeFile {
  /** The `# judge:` line's text: question, rubric, prompt hash and model. */
  identity: string;
  rows: MarkedRow[];
}

export function parseJudgeFile(text: string): JudgeFile {
  const [first, ...rest] = text.split('\n');
  const match = JUDGE_LINE.exec(first.trim());
  if (!match) {
    throw new Error('judge file must start with a "# judge:" line');
  }
  return { identity: match[1].trim(), rows: parseMarks(rest.join('\n')).rows };
}

/** Picks one run's judge file from the names in its directory. */
export function pickJudgeFile(names: string[], prompt: string | null): string {
  const found = names.filter((name) => JUDGE_FILE.test(name)).sort();
  if (prompt !== null) {
    const wanted = `judge.${prompt}.csv`;
    if (!found.includes(wanted)) throw new Error(`no ${wanted}`);
    return wanted;
  }
  if (found.length === 0) {
    throw new Error('no judge file — run task ev2:judge on it first');
  }
  if (found.length > 1) {
    throw new Error(
      `judged ${found.length} times (${found.join(', ')}) — pick one with --prompt <hash>`,
    );
  }
  return found[0];
}

export interface RunMarks {
  runId: string;
  hand: MarkedRow[];
  judge: MarkedRow[];
}

export interface Disagreement {
  runId: string;
  fixtureId: string;
  rep: string;
  hand: Mark;
  judge: Mark;
  judgeNote: string;
}

export interface Counts {
  /** Hand pass/fail marks that the judge also marked. */
  marks: number;
  agree: number;
  judgePassHandFail: number;
  judgeFailHandPass: number;
  /** The judge said `na` where the hand mark is pass or fail. */
  judgeNa: number;
}

export interface CheckResult {
  total: Counts;
  cases: ({ fixtureId: string } & Counts)[];
  /** Hand `na` marks, kept out of `total`. */
  handNa: { marks: number; judgeNa: number };
  skipped: { error: number; noStart: number; notJudged: number };
  disagreements: Disagreement[];
  agreement: number | null;
  meetsAgreement: boolean;
  meetsJudgePass: boolean;
}

const emptyCounts = (): Counts => ({
  marks: 0,
  agree: 0,
  judgePassHandFail: 0,
  judgeFailHandPass: 0,
  judgeNa: 0,
});

export function check(runs: RunMarks[]): CheckResult {
  const total = emptyCounts();
  const byCase = new Map<string, Counts>();
  const handNa = { marks: 0, judgeNa: 0 };
  const skipped = { error: 0, noStart: 0, notJudged: 0 };
  const disagreements: Disagreement[] = [];

  for (const run of runs) {
    const judged = new Map(
      run.judge.map((row) => [`${row.fixtureId},${row.rep}`, row]),
    );

    for (const hand of run.hand) {
      // A turn that threw has no narration to mark.
      if (hand.mark === 'error') {
        skipped.error++;
        continue;
      }
      // The judge is given no start for the case, so it cannot mark it:
      // turn 01, which Rubric v1 cannot mark either.
      if (STARTS[hand.fixtureId] === undefined) {
        skipped.noStart++;
        continue;
      }
      const judge = judged.get(`${hand.fixtureId},${hand.rep}`);
      if (!judge) {
        skipped.notJudged++;
        continue;
      }

      const differs = judge.mark !== hand.mark;
      if (differs) {
        disagreements.push({
          runId: run.runId,
          fixtureId: hand.fixtureId,
          rep: hand.rep,
          hand: hand.mark,
          judge: judge.mark,
          judgeNote: judge.note,
        });
      }

      if (hand.mark === 'na') {
        handNa.marks++;
        if (!differs) handNa.judgeNa++;
        continue;
      }

      const counts = byCase.get(hand.fixtureId) ?? emptyCounts();
      byCase.set(hand.fixtureId, counts);
      for (const c of [total, counts]) {
        c.marks++;
        if (!differs) c.agree++;
        else if (judge.mark === 'na') c.judgeNa++;
        else if (judge.mark === 'pass') c.judgePassHandFail++;
        else c.judgeFailHandPass++;
      }
    }
  }

  const agreement = total.marks === 0 ? null : total.agree / total.marks;
  return {
    total,
    cases: [...byCase].map(([fixtureId, counts]) => ({ fixtureId, ...counts })),
    handNa,
    skipped,
    disagreements,
    agreement,
    meetsAgreement: agreement !== null && agreement >= AGREEMENT_LIMIT,
    meetsJudgePass: total.judgePassHandFail <= JUDGE_PASS_LIMIT,
  };
}

function renderTable(rows: string[][]): string[] {
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((row) => row[col].length)),
  );
  return rows.map((row) =>
    row
      .map((cell, col) =>
        col === 0 ? cell.padEnd(widths[col]) : cell.padStart(widths[col]),
      )
      .join('  ')
      .trimEnd(),
  );
}

export function renderCheck(
  identity: string,
  runCount: number,
  result: CheckResult,
): string {
  const { total, handNa, skipped } = result;
  const met = (ok: boolean): string => (ok ? 'met' : 'NOT met');

  const lines = [
    `judge  ${identity}`,
    `runs   ${runCount} · ${total.marks} pass/fail marks · ${handNa.marks} na · ${skipped.error} error skipped · ${skipped.noStart} skipped with no start`,
  ];
  if (skipped.notJudged > 0) {
    lines.push(
      `       ${skipped.notJudged} marked rep(s) have no judge mark and are left out`,
    );
  }

  lines.push(
    '',
    ...renderTable([
      [
        'agreement',
        `${total.agree} of ${total.marks}`,
        result.agreement === null ? '—' : result.agreement.toFixed(2),
        `limit ${AGREEMENT_LIMIT.toFixed(2)}`,
        met(result.meetsAgreement),
      ],
      [
        'judge pass, you fail',
        String(total.judgePassHandFail),
        '',
        `limit ${JUDGE_PASS_LIMIT}`,
        met(result.meetsJudgePass),
      ],
      ['judge fail, you pass', String(total.judgeFailHandPass), '', '', ''],
      ['judge na, you marked', String(total.judgeNa), '', '', ''],
    ]),
    '',
    ...renderTable([
      [
        'case',
        'marks',
        'agree',
        'judge pass/you fail',
        'judge fail/you pass',
        'judge na',
      ],
      ...result.cases.map((c) => [
        c.fixtureId,
        String(c.marks),
        String(c.agree),
        String(c.judgePassHandFail),
        String(c.judgeFailHandPass),
        String(c.judgeNa),
      ]),
    ]),
  );

  if (handNa.marks > 0) {
    lines.push(
      '',
      `Your na marks: judge na ${handNa.judgeNa} of ${handNa.marks}`,
    );
  }

  lines.push(
    '',
    result.disagreements.length === 0 ? 'No disagreements.' : 'Disagreements',
  );
  for (const d of result.disagreements) {
    lines.push(
      `  ${d.runId}  ${d.fixtureId}  ${d.rep}   you ${d.hand} · judge ${d.judge}`,
      `    judge: ${d.judgeNote}`,
    );
  }
  return lines.join('\n');
}

function loadRun(
  arg: string,
  prompt: string | null,
): RunMarks & { identity: string } {
  const dir = resolveRunDir(arg);
  const runId = basename(dir);
  const marksPath = join(dir, 'marks.csv');
  if (!existsSync(marksPath)) {
    throw new Error(`${marksPath} does not exist — nothing to check against.`);
  }

  let judgeName: string;
  try {
    judgeName = pickJudgeFile(readdirSync(dir), prompt);
  } catch (err) {
    throw new Error(`${runId}: ${err instanceof Error ? err.message : err}`);
  }
  const judge = parseJudgeFile(readFileSync(join(dir, judgeName), 'utf8'));

  return {
    runId,
    identity: judge.identity,
    hand: parseMarks(readFileSync(marksPath, 'utf8')).rows,
    judge: judge.rows,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const runs = args.runs.map((run) => loadRun(run, args.prompt));

  const identities = [...new Set(runs.map((run) => run.identity))];
  if (identities.length > 1) {
    throw new Error(
      `the runs were judged by different judges:\n  ${identities.join('\n  ')}`,
    );
  }

  console.log(renderCheck(identities[0], runs.length, check(runs)));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
