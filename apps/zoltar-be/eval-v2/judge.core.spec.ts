import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CASES } from './cases';
import { loadFixture } from './fixture';
import {
  buildJudgeRequest,
  JUDGE_MODEL,
  judgeFileName,
  parseArgs,
  parseCaseMd,
  parseJudgeAnswer,
  parseRepMd,
  promptHash,
  renderJudgeCsv,
  STARTS,
} from './judge.core';
import { renderCaseMd, renderRepMd } from './run.core';

import type Anthropic from '@anthropic-ai/sdk';

const RUBRIC = readFileSync(join(__dirname, 'judge-rubric-q1-v1.txt'), 'utf8');
const TURN_24 = '2c0ba938-turn24-seeded-canon-contradiction';

// Turn 24's fixture carries world facts the Warden wrote during the session
// (`crew_roster` among them) beside the four it was seeded with.
const turn24 = () => parseCaseMd(renderCaseMd(loadFixture(TURN_24)));

function answer(input: unknown): Anthropic.Message {
  return {
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify(input) },
    ],
  } as unknown as Anthropic.Message;
}

describe('parseArgs', () => {
  it('judges every case when none is named', () => {
    expect(parseArgs(['run-a'])).toEqual({ run: 'run-a', fixtureIds: null });
  });

  it('narrows to the named fixtures', () => {
    expect(parseArgs(['run-a', '--fixtures', 'x, y'])).toEqual({
      run: 'run-a',
      fixtureIds: ['x', 'y'],
    });
  });

  it.each([
    [[]],
    [['--fixtures', 'x']],
    [['run-a', '--reps', '2']],
  ])('rejects %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow(/Usage/);
  });
});

describe('STARTS', () => {
  it('names only cases of question 1', () => {
    const cases: readonly string[] = CASES.q1;
    expect(Object.keys(STARTS).filter((id) => !cases.includes(id))).toEqual([]);
  });

  it('has no start for the timeline case, which Rubric v1 cannot mark', () => {
    expect(
      STARTS['2c0ba938-turn01-seeded-canon-contradiction'],
    ).toBeUndefined();
  });
});

describe('parseCaseMd', () => {
  it('keeps the four seeded facts and drops the ones the Warden wrote', () => {
    const caseText = turn24();
    expect(caseText.seededFacts.map((f) => f.key)).toEqual([
      'ship_layout',
      'colonist_count',
      'danny_relationship',
      'communications_status',
    ]);
    expect(caseText.seededFacts[0].text).toContain('DECK 2 (mid): crew berths');
  });

  it('reads the player input without its quote marks', () => {
    expect(turn24().playerInput).toBe(loadFixture(TURN_24).playerInput.content);
  });

  it('reads the opening narration to the end of the file', () => {
    const { openingNarration } = turn24();
    expect(openingNarration).toMatch(/^The ladder shaft groans/);
    expect(openingNarration.length).toBeGreaterThan(500);
  });

  it('refuses a case with a seeded fact missing', () => {
    const text = renderCaseMd(loadFixture(TURN_24)).replace(
      '### colonist_count',
      '### colonists',
    );
    expect(() => parseCaseMd(text)).toThrow(/no "colonist_count" world fact/);
  });
});

describe('parseRepMd', () => {
  it('drops the heading and keeps the narration', () => {
    expect(parseRepMd(renderRepMd('a', 3, 'You knock.\n\nShe answers.'))).toBe(
      'You knock.\n\nShe answers.',
    );
  });
});

describe('buildJudgeRequest', () => {
  const request = buildJudgeRequest({
    rubric: RUBRIC,
    fixtureId: TURN_24,
    caseText: turn24(),
    narration: 'The mess is one deck up.',
  });
  const sent = JSON.stringify(request);

  it('sends the rubric word for word, on the judge model', () => {
    expect(request.model).toBe(JUDGE_MODEL);
    expect(request.system).toContain(RUBRIC.trim());
  });

  it('sends the start, the player input and the narration', () => {
    const [{ content }] = request.messages;
    expect(content).toContain(`Danny starts this turn at: ${STARTS[TURN_24]}`);
    expect(content).toContain(turn24().playerInput);
    expect(content).toContain(
      '<narration>\nThe mess is one deck up.\n</narration>',
    );
  });

  it('leaves out the world facts the Warden wrote during the session', () => {
    expect(JSON.stringify(loadFixture(TURN_24))).toContain('crew_roster');
    expect(sent).not.toContain('crew_roster');
    expect(sent).not.toContain('insurance_file_copies');
  });

  it('asks for the answer as JSON in a fixed shape, with no forced tool', () => {
    expect(request.tool_choice).toBeUndefined();
    expect(request.tools).toBeUndefined();
    expect(request.output_config?.format).toMatchObject({
      type: 'json_schema',
      schema: {
        required: ['indicators', 'reason', 'mark'],
        additionalProperties: false,
      },
    });
  });

  it('refuses a case with no start', () => {
    expect(() =>
      buildJudgeRequest({
        rubric: RUBRIC,
        fixtureId: '2c0ba938-turn01-seeded-canon-contradiction',
        caseText: turn24(),
        narration: 'x',
      }),
    ).toThrow(/no start recorded/);
  });
});

describe('promptHash', () => {
  it('is eight hex characters and stable', () => {
    expect(promptHash(RUBRIC)).toMatch(/^[0-9a-f]{8}$/);
    expect(promptHash(RUBRIC)).toBe(promptHash(RUBRIC));
  });

  it('changes with the rubric', () => {
    expect(promptHash(`${RUBRIC}\n- one more rule`)).not.toBe(
      promptHash(RUBRIC),
    );
  });
});

describe('parseJudgeAnswer', () => {
  it('reads the mark, the reason and the indicators', () => {
    expect(
      parseJudgeAnswer(
        answer({
          indicators: ['down to the lower deck'],
          reason: ' Berths are on mid-deck. ',
          mark: 'fail',
        }),
      ),
    ).toEqual({
      mark: 'fail',
      reason: 'Berths are on mid-deck.',
      indicators: ['down to the lower deck'],
    });
  });

  it.each([
    ['an unknown mark', { indicators: [], reason: 'r', mark: 'error' }],
    ['a missing mark', { indicators: [], reason: 'r' }],
    ['no reason', { indicators: [], reason: '', mark: 'na' }],
    ['no indicators', { reason: 'r', mark: 'na' }],
  ])('refuses %s', (_, input) => {
    expect(() => parseJudgeAnswer(answer(input))).toThrow(/the judge gave/);
  });

  it('refuses an answer that is not JSON', () => {
    expect(() =>
      parseJudgeAnswer({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'pass' }],
      } as unknown as Anthropic.Message),
    ).toThrow(/not JSON/);
  });

  it.each([
    'refusal',
    'max_tokens',
  ])('refuses an answer that stopped on %s', (stop_reason) => {
    expect(() =>
      parseJudgeAnswer({
        ...answer({ indicators: [], reason: 'r', mark: 'pass' }),
        stop_reason,
      } as unknown as Anthropic.Message),
    ).toThrow(/stopped early/);
  });
});

describe('renderJudgeCsv', () => {
  const identity = {
    question: 'q1',
    rubric: 'v1',
    prompt: '3fa1c2d0',
    model: JUDGE_MODEL,
  };

  it('names the file after the prompt hash', () => {
    expect(judgeFileName('3fa1c2d0')).toBe('judge.3fa1c2d0.csv');
  });

  it('writes the judge line, the header and one row per mark', () => {
    expect(
      renderJudgeCsv(identity, [
        {
          fixtureId: 'a',
          rep: '01',
          mark: 'fail',
          note: 'deck 3, not\ndeck 2',
        },
        { fixtureId: 'a', rep: '02', mark: 'na', note: 'names no deck' },
      ]),
    ).toBe(
      [
        `# judge: q1 rubric v1 · prompt 3fa1c2d0 · ${JUDGE_MODEL}`,
        'fixture,rep,mark,note',
        'a,01,fail,deck 3, not deck 2',
        'a,02,na,names no deck',
        '',
      ].join('\n'),
    );
  });
});
