/**
 * The parts of `ev2:judge` that touch nothing: what the judge is sent for one
 * narration, how its answer is read, and the file its marks are written to
 * (spec 028).
 *
 * The judge marks question 1 under Rubric v1. It is never shown the hand
 * marks: nothing here or in `judge.ts` opens `marks.csv`.
 */
import { createHash } from 'node:crypto';

import type Anthropic from '@anthropic-ai/sdk';

export const JUDGE_MODEL = 'claude-opus-5-5';
export const JUDGE_QUESTION = 'q1';
export const JUDGE_RUBRIC = 'v1';

const USAGE = 'Usage: task ev2:judge -- <run> [--fixtures <id,id>]';

/** Written as the note when the judge gives a mark and no reason. */
export const NO_REASON = '(no reason given)';

const JUDGE_MARKS = ['pass', 'fail', 'na'] as const;
export type JudgeMark = (typeof JUDGE_MARKS)[number];

/**
 * Where Danny starts in each case, per the session's history. Rubric v1 fixes
 * one start per case and the hand marks were made from it, so the judge is
 * told it and does not work it out.
 *
 * The five captured cases are the rubric's own table. The constructed cases
 * are all copies of turn 18 that leave the start where it was.
 *
 * A case with no entry is not judged. Turn 01 has none on purpose: it is the
 * timeline case, and Rubric v1 marks layout only.
 */
export const STARTS: Readonly<Record<string, string>> = {
  '2c0ba938-turn08-seeded-canon-contradiction': 'the bridge, upper deck',
  '2c0ba938-turn14-seeded-canon-contradiction':
    'the corridor outside the cryo bay, mid-deck',
  '2c0ba938-turn18-seeded-canon-contradiction':
    'the cryo bay bulkhead, mid-deck',
  '2c0ba938-turn18-berth-corrected': 'the cryo bay bulkhead, mid-deck',
  '2c0ba938-turn18-berth-retracted': 'the cryo bay bulkhead, mid-deck',
  '2c0ba938-turn18-berth-retracted-tidy': 'the cryo bay bulkhead, mid-deck',
  '2c0ba938-turn18-position-seeded': 'the cryo bay bulkhead, mid-deck',
  '2c0ba938-turn18-return-stated': 'the cryo bay bulkhead, mid-deck',
  '2c0ba938-turn24-seeded-canon-contradiction':
    "Mara's berth, which turns 14 and 18 put on the lower deck",
  '2c0ba938-turn29-seeded-canon-contradiction': 'the mess hall, mid-deck',
};

/** The facts the adventure was seeded with, which is Rubric v1's ground truth. */
const SEEDED_FACTS = [
  'ship_layout',
  'colonist_count',
  'danny_relationship',
  'communications_status',
];

const INSTRUCTIONS = [
  'You are marking one narration from a tabletop RPG session. The Warden (the',
  'game master) wrote it in reply to a player. Danny is the player character.',
  '',
  'Mark the narration under the rubric below, exactly as the rubric is written.',
  'The rubric was written by the person whose marks yours will be compared',
  'with. "I" in it is that person. Where it mentions a playtest report, you',
  'have no report: the starting position you need is given to you with the',
  'case.',
  '',
  'You are given the initial game state (the seeded world facts and the',
  'opening narration), where Danny starts this turn, what the player said, and',
  'the narration. Mark only the narration. Mark deck position only: where',
  'places and people are, and the routes between them.',
  '',
  'Answer with the JSON object the response format asks for, and nothing else.',
].join('\n');

/**
 * How hard the judge thinks. Set and not left to the model's default, which
 * differs between models, so that it is part of what the prompt hash covers.
 */
const EFFORT = 'high';

/**
 * The shape of the judge's answer, enforced by the API (structured outputs).
 * `claude-opus-5-5` does not accept a forced tool call, which is the other
 * way to get one.
 */
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    indicators: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Each phrase in the narration that says where a place or person is, or narrates a change of position. Quote the narration. Empty when there are none.',
    },
    reason: {
      type: 'string',
      description:
        'One sentence: what the indicators say, set against the seeded layout and the start.',
    },
    mark: {
      type: 'string',
      enum: [...JUDGE_MARKS],
      description: 'pass, fail or na, as the rubric defines them.',
    },
  },
  required: ['indicators', 'reason', 'mark'],
  additionalProperties: false,
};

export interface JudgeArgs {
  run: string;
  /** Null when every case of the run is to be judged. */
  fixtureIds: string[] | null;
}

export function parseArgs(argv: string[]): JudgeArgs {
  const [run, ...rest] = argv;
  if (!run || run.startsWith('--')) throw new Error(USAGE);
  if (rest.length === 0) return { run, fixtureIds: null };
  if (rest.length !== 2 || rest[0] !== '--fixtures') throw new Error(USAGE);
  const fixtureIds = rest[1]
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  if (fixtureIds.length === 0) throw new Error(USAGE);
  return { run, fixtureIds };
}

export interface CaseText {
  playerInput: string;
  /** The seeded facts only, in `SEEDED_FACTS` order. */
  seededFacts: { key: string; text: string }[];
  openingNarration: string;
}

/**
 * Reads a run's `case.md` (written by `renderCaseMd`). The world facts the
 * Warden wrote during the session are in that file too and are dropped here:
 * Rubric v1 marks against the seeded state only.
 */
export function parseCaseMd(text: string): CaseText {
  const section = (title: string): string => {
    const match = new RegExp(
      `^## ${title}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
      'm',
    ).exec(text);
    if (!match) throw new Error(`case.md has no "## ${title}" section`);
    return match[1].trim();
  };

  const facts = new Map<string, string>();
  for (const part of section('World facts').split(/^### /m).slice(1)) {
    const [key, ...body] = part.split('\n');
    facts.set(key.trim(), body.join('\n').trim());
  }

  const seededFacts = SEEDED_FACTS.map((key) => {
    const fact = facts.get(key);
    if (fact === undefined) {
      throw new Error(`case.md has no "${key}" world fact`);
    }
    return { key, text: fact };
  });

  return {
    playerInput: section('Player input')
      .split('\n')
      .map((line) => line.replace(/^> ?/, ''))
      .join('\n'),
    seededFacts,
    openingNarration: section('Opening narration'),
  };
}

/** A `rep-NN.md` (written by `renderRepMd`) without its heading line. */
export function parseRepMd(text: string): string {
  return text.replace(/^# .*\n/, '').trim();
}

/**
 * Identifies the judge: everything it is sent that is the same for every
 * narration. A run judged under another hash was judged by another judge.
 */
export function promptHash(rubric: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([INSTRUCTIONS, rubric, STARTS, ANSWER_SCHEMA, EFFORT]),
    )
    .digest('hex')
    .slice(0, 8);
}

export function buildJudgeRequest(input: {
  rubric: string;
  fixtureId: string;
  caseText: CaseText;
  narration: string;
}): Anthropic.MessageCreateParamsNonStreaming {
  const start = STARTS[input.fixtureId];
  if (start === undefined) {
    throw new Error(`no start recorded for ${input.fixtureId}`);
  }

  const facts = input.caseText.seededFacts
    .map((fact) => `<${fact.key}>\n${fact.text}\n</${fact.key}>`)
    .join('\n');

  const content = [
    `<seeded_world_facts>\n${facts}\n</seeded_world_facts>`,
    `<opening_narration>\n${input.caseText.openingNarration}\n</opening_narration>`,
    `<start>\nDanny starts this turn at: ${start}\n</start>`,
    `<player_input>\n${input.caseText.playerInput}\n</player_input>`,
    `<narration>\n${input.narration}\n</narration>`,
  ].join('\n\n');

  return {
    model: JUDGE_MODEL,
    // Thinking is always on for this model and counts toward the limit.
    max_tokens: 16000,
    system: `${INSTRUCTIONS}\n\n<rubric>\n${input.rubric.trim()}\n</rubric>`,
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
    },
    messages: [{ role: 'user', content }],
  };
}

export interface JudgeAnswer {
  mark: JudgeMark;
  reason: string;
  indicators: string[];
}

export function parseJudgeAnswer(message: Anthropic.Message): JudgeAnswer {
  // A refusal or a cut-off answer is not a mark.
  if (message.stop_reason !== 'end_turn') {
    throw new Error(`the judge stopped early: ${message.stop_reason}`);
  }
  const text = message.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  if (!text) throw new Error('the judge gave no answer');

  let answer: unknown;
  try {
    answer = JSON.parse(text.text);
  } catch {
    throw new Error('the judge gave an answer that is not JSON');
  }
  if (typeof answer !== 'object' || answer === null) {
    throw new Error('the judge gave an answer that is not an object');
  }

  const { mark, reason, indicators } = answer as Record<string, unknown>;
  if (!(JUDGE_MARKS as readonly unknown[]).includes(mark)) {
    throw new Error(`the judge gave an unknown mark: ${JSON.stringify(mark)}`);
  }
  if (typeof reason !== 'string') {
    throw new Error('the judge gave no reason');
  }
  if (
    !Array.isArray(indicators) ||
    indicators.some((indicator) => typeof indicator !== 'string')
  ) {
    throw new Error('the judge gave no list of indicators');
  }
  return {
    mark: mark as JudgeMark,
    // The mark is the answer. A blank reason is kept as a mark with nothing
    // to read beside it, not thrown away with the run.
    reason: reason.trim() || NO_REASON,
    indicators: indicators as string[],
  };
}

export interface JudgeIdentity {
  question: string;
  rubric: string;
  prompt: string;
  model: string;
}

export interface JudgeRow {
  fixtureId: string;
  rep: string;
  mark: JudgeMark;
  note: string;
}

export function judgeFileName(prompt: string): string {
  return `judge.${prompt}.csv`;
}

export function renderJudgeHeader(identity: JudgeIdentity): string {
  return `# judge: ${identity.question} rubric ${identity.rubric} · prompt ${identity.prompt} · ${identity.model}`;
}

/**
 * The shape of `marks.csv` under a `# judge:` line. A note keeps its commas
 * and loses its line breaks, which is what `parseMarks` can read back.
 */
export function renderJudgeCsv(
  identity: JudgeIdentity,
  rows: JudgeRow[],
): string {
  const lines = rows.map(
    (r) =>
      `${r.fixtureId},${r.rep},${r.mark},${r.note.replace(/\s*\n\s*/g, ' ')}`,
  );
  return [
    renderJudgeHeader(identity),
    'fixture,rep,mark,note',
    ...lines,
    '',
  ].join('\n');
}
