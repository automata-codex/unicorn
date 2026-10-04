/**
 * `task ev2:run` — replays each labeled case N times through the real turn
 * code and writes what the Warden said to disk. Grades nothing: the
 * maintainer marks `marks.csv` by hand, then `task ev2:report` tallies it.
 *
 * Writes to the database `DATABASE_URL` names and makes real Anthropic calls:
 * cases × reps Warden turns.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CASES, isQuestionId } from './cases';
import { loadFixture } from './fixture';
import {
  bootApp,
  findPrereqs,
  runTurn,
  seedScratch,
  teardownScratch,
} from './replay';

import type { QuestionId } from './cases';
import type { Fixture } from './fixture';

const USAGE =
  'Usage: task ev2:run -- --question <id> --reps <n> [--fixtures <id,id>]';

export interface RunArgs {
  question: QuestionId;
  reps: number;
  fixtureIds: string[];
}

export function parseArgs(argv: string[]): RunArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--question', '--reps', '--fixtures'].includes(flag)) {
      throw new Error(`unknown argument "${flag}". ${USAGE}`);
    }
    if (value === undefined) {
      throw new Error(`${flag} needs a value. ${USAGE}`);
    }
    flags.set(flag, value);
  }

  const question = flags.get('--question');
  if (!question || !isQuestionId(question)) {
    throw new Error(
      `--question must be one of: ${Object.keys(CASES).join(', ')}. ${USAGE}`,
    );
  }

  const repsText = flags.get('--reps') ?? '';
  const reps = Number(repsText);
  if (!/^\d+$/.test(repsText) || reps < 1) {
    throw new Error(`--reps must be a positive whole number. ${USAGE}`);
  }

  const all: readonly string[] = CASES[question];
  const picked = flags.get('--fixtures')?.split(',');
  const unknown = (picked ?? []).filter((id) => !all.includes(id));
  if (unknown.length > 0) {
    throw new Error(
      `not a case of ${question}: ${unknown.join(', ')}. Its cases are: ${all.join(', ')}`,
    );
  }

  return { question, reps, fixtureIds: picked ?? [...all] };
}

/** The ground truth a narration is marked against, next to the outputs. */
export function renderCaseMd(fixture: Fixture): string {
  const { campaignState, gmContextBlob } = fixture.seededState;
  const worldFacts = (campaignState.worldFacts ?? {}) as Record<
    string,
    unknown
  >;
  const opening =
    typeof gmContextBlob.openingNarration === 'string'
      ? gmContextBlob.openingNarration
      : '_none recorded_';

  const facts = Object.entries(worldFacts).map(
    ([key, value]) =>
      `### ${key}\n\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`,
  );

  return [
    `# ${fixture.id}`,
    '## Player input',
    quote(fixture.playerInput.content),
    '## World facts',
    ...(facts.length > 0 ? facts : ['_none_']),
    '## Opening narration',
    opening,
    '',
  ].join('\n\n');
}

export function renderRepMd(
  fixtureId: string,
  rep: number,
  body: string,
): string {
  return `# ${fixtureId} — rep ${pad(rep)}\n\n${body}\n`;
}

export interface MarkRow {
  fixtureId: string;
  rep: number;
  /** Empty for the maintainer to fill in; `error` when the turn threw. */
  mark: '' | 'error';
}

export function renderMarksCsv(rows: MarkRow[]): string {
  const lines = rows.map((r) => `${r.fixtureId},${pad(r.rep)},${r.mark},`);
  return ['fixture,rep,mark,note', ...lines, ''].join('\n');
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function pad(rep: number): string {
  return String(rep).padStart(2, '0');
}

function git(command: string): string {
  return execSync(`git ${command}`, { encoding: 'utf8' }).trim();
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const root = process.env.ZOLTAR_EVAL_ROOT;
  if (!root) throw new Error('ZOLTAR_EVAL_ROOT is not set.');

  // Preflight: everything that can fail without spending anything fails
  // here, before the first Warden turn.
  const fixtures = args.fixtureIds.map(loadFixture);
  const app = await bootApp();

  try {
    const prereqs = await findPrereqs(app.db);

    const startedAt = new Date();
    const runId = startedAt
      .toISOString()
      .replace(/\.\d+Z$/, 'Z')
      .replace(/:/g, '-');
    const runDir = join(root, 'eval-v2-runs', runId);
    mkdirSync(runDir, { recursive: true });

    const runInfo = {
      runId,
      question: args.question,
      reps: args.reps,
      fixtures: args.fixtureIds,
      commit: git('rev-parse HEAD'),
      dirty: git('status --porcelain') !== '',
      prompt: app.prompt,
      startedAt: startedAt.toISOString(),
    };
    writeJson(join(runDir, 'run.json'), runInfo);

    console.log(`Run ${runId}`);
    console.log(`  prompt ${app.prompt.filename} (${app.prompt.hash})`);
    console.log(
      `  ${fixtures.length} case(s) × ${args.reps} rep(s) = ${fixtures.length * args.reps} Warden turn(s)`,
    );

    const marks: MarkRow[] = [];

    for (const fixture of fixtures) {
      const caseDir = join(runDir, fixture.id);
      mkdirSync(caseDir);
      writeFileSync(join(caseDir, 'case.md'), renderCaseMd(fixture));

      for (let rep = 1; rep <= args.reps; rep++) {
        const base = join(caseDir, `rep-${pad(rep)}`);
        const began = Date.now();
        let mark: MarkRow['mark'] = '';

        const scratch = await seedScratch(
          app.db,
          fixture,
          prereqs,
          `__ev2__${fixture.id}__${runId}__${pad(rep)}`,
        );
        try {
          const result = await runTurn(app.sessionService, fixture, scratch);
          writeJson(`${base}.json`, { ok: true, result });
          writeFileSync(
            `${base}.md`,
            renderRepMd(fixture.id, rep, result.message.content),
          );
        } catch (err) {
          // A turn that threw is not a wrong answer. It is recorded as an
          // error, kept out of the pass rate, and the run carries on.
          mark = 'error';
          const error =
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : { message: String(err) };
          writeJson(`${base}.json`, { ok: false, error });
          writeFileSync(
            `${base}.md`,
            renderRepMd(fixture.id, rep, `**Turn threw:** ${error.message}`),
          );
        } finally {
          await teardownScratch(app.db, scratch.campaignId);
        }

        marks.push({ fixtureId: fixture.id, rep, mark });
        const seconds = Math.round((Date.now() - began) / 1000);
        console.log(
          `  ${fixture.id} rep ${pad(rep)}/${pad(args.reps)} ${mark || 'ok'} (${seconds}s)`,
        );
      }
    }

    // Written last, so an interrupted run has no marks file to report on.
    writeFileSync(join(runDir, 'marks.csv'), renderMarksCsv(marks));
    writeJson(join(runDir, 'run.json'), {
      ...runInfo,
      endedAt: new Date().toISOString(),
    });

    const errors = marks.filter((m) => m.mark === 'error').length;
    console.log(`\nWrote ${runDir}`);
    console.log(`  ${marks.length} rep(s), ${errors} error(s)`);
    console.log('  Next: fill in marks.csv (pass / fail / na), then');
    console.log(`  task ev2:report -- ${runDir}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
