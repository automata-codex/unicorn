/**
 * The parts of `ev2:run` that touch nothing: argument parsing and rendering.
 *
 * Kept apart from `run.ts` so unit tests can import them. `run.ts` imports
 * `replay.ts`, which imports `AppModule`, whose config validation runs at
 * import time and fails without real env vars — which is CI's state.
 */
import { CASES, isQuestionId } from './cases';

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

/**
 * The rubric line is written blank: the version is known when the marking is
 * done, not when the run is (spec 027).
 */
export function renderMarksCsv(rows: MarkRow[]): string {
  const lines = rows.map((r) => `${r.fixtureId},${pad(r.rep)},${r.mark},`);
  return ['# rubric:', 'fixture,rep,mark,note', ...lines, ''].join('\n');
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export function pad(rep: number): string {
  return String(rep).padStart(2, '0');
}
