import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendCompletedRep, createRunDirectory } from './manifest';
import { repDir, scoresPath } from './paths';
import {
  ScoreRowError,
  ScoreWriter,
  readScoreRows,
  readVouchedRows,
  scoreRowSchema,
} from './scores';

import type { CompletedRep } from './manifest';
import type { ScoreRow } from './scores';

const CREATED_AT = new Date('2026-07-26T14:32:10.000Z');

function scoreRow(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    runId: 'run-1',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1.0,
    corpusVersion: 'abc',
    harnessVersion: 'abc1234',
    repIndex: 1,
    fixtureId: 'turn19-out-of-order-resolution',
    checkId: 'out-of-order-resolution',
    tag: 'OUT-OF-ORDER-RESOLUTION',
    checkMode: 'structural',
    verdict: 'pass',
    artifactPath: 'reps/001/turn19-out-of-order-resolution/warden-output.json',
    durationMs: 12,
    recordedAt: '2026-07-26T14:33:00.000Z',
    ...overrides,
  };
}

describe('scoreRowSchema', () => {
  it('accepts a valid pass row', () => {
    expect(() => scoreRowSchema.parse(scoreRow())).not.toThrow();
  });

  it('accepts a valid fail row', () => {
    expect(() =>
      scoreRowSchema.parse(scoreRow({ verdict: 'fail' })),
    ).not.toThrow();
  });

  it('rejects not_applicable without notApplicableReason', () => {
    expect(() =>
      scoreRowSchema.parse(scoreRow({ verdict: 'not_applicable' })),
    ).toThrow();
  });

  it('accepts not_applicable with notApplicableReason', () => {
    expect(() =>
      scoreRowSchema.parse(
        scoreRow({
          verdict: 'not_applicable',
          notApplicableReason: 'no dice_roll this turn',
        }),
      ),
    ).not.toThrow();
  });

  it('accepts not_applicable with a notApplicableReasonCode alongside the reason', () => {
    expect(() =>
      scoreRowSchema.parse(
        scoreRow({
          verdict: 'not_applicable',
          notApplicableReason:
            'the turn deferred Alvarez\'s gating roll to a pending dice_request ' +
            '("Alvarez combat roll to hit") rather than resolving it this turn',
          notApplicableReasonCode:
            "deferred Alvarez's gating roll to a pending dice_request",
        }),
      ),
    ).not.toThrow();
  });

  it('rejects error without errorMessage', () => {
    expect(() =>
      scoreRowSchema.parse(scoreRow({ verdict: 'error' })),
    ).toThrow();
  });

  it('accepts error with errorMessage', () => {
    expect(() =>
      scoreRowSchema.parse(
        scoreRow({ verdict: 'error', errorMessage: 'API timeout' }),
      ),
    ).not.toThrow();
  });
});

describe('ScoreWriter / readScoreRows round-trip', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eval-scores-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes and reads back rows in order', async () => {
    const path = join(dir, 'scores.jsonl');
    const writer = new ScoreWriter();
    writer.open(path);
    writer.append(scoreRow({ fixtureId: 'a' }));
    writer.append(scoreRow({ fixtureId: 'b', verdict: 'fail' }));
    await writer.close();

    const rows = readScoreRows(path);
    expect(rows.map((r) => r.fixtureId)).toEqual(['a', 'b']);
    expect(rows[1].verdict).toBe('fail');
  });

  it('reports the line number of a truncated/malformed final line', () => {
    const path = join(dir, 'scores.jsonl');
    writeFileSync(
      path,
      `${JSON.stringify(scoreRow())}\n{ "not": "valid json"\n`,
    );

    expect(() => readScoreRows(path)).toThrow(ScoreRowError);
    try {
      readScoreRows(path);
    } catch (err) {
      expect((err as ScoreRowError).lineNumber).toBe(2);
      expect((err as ScoreRowError).filePath).toBe(path);
    }
  });
});

describe('readVouchedRows', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eval-vouched-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeRepScores(runDir: string, index: number, rows: ScoreRow[]) {
    mkdirSync(repDir(runDir, index), { recursive: true });
    const path = scoresPath(runDir, index);
    writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  function vouch(runDir: string, entry: Partial<CompletedRep> & { index: number }) {
    const completed: CompletedRep = {
      harnessVersion: 'abc1234',
      rubricHashes: {},
      fixtureIds: [],
      startedAt: '2026-07-26T14:33:00.000Z',
      completedAt: '2026-07-26T14:35:00.000Z',
      ...entry,
    };
    appendCompletedRep(runDir, completed);
  }

  it('returns only vouched rows and names an unvouched rep dir in exclusions', () => {
    const runDir = createRunDirectory({
      root,
      model: 'claude-sonnet-4-6',
      promptHash: 'ab12cd34',
      promptText: 'prompt',
      temperature: 1.0,
      corpusVersion: 'abc',
      plannedReps: 3,
      createdAt: CREATED_AT,
    });

    writeRepScores(runDir, 1, [scoreRow({ repIndex: 1, fixtureId: 'a' })]);
    vouch(runDir, { index: 1, fixtureIds: ['a'] });

    writeRepScores(runDir, 2, [scoreRow({ repIndex: 2, fixtureId: 'a' })]);
    vouch(runDir, { index: 2, fixtureIds: ['a'] });

    // rep 3 exists on disk but is never vouched — simulates a crash.
    writeRepScores(runDir, 3, [scoreRow({ repIndex: 3, fixtureId: 'a' })]);

    const { rows, exclusions } = readVouchedRows(runDir);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.repIndex === 1 || r.repIndex === 2)).toBe(true);
    expect(exclusions.some((e) => e.includes('003') && e.includes('not vouched'))).toBe(
      true,
    );
  });

  it('drops rows for a fixture not in the vouched fixtureIds subset', () => {
    const runDir = createRunDirectory({
      root,
      model: 'claude-sonnet-4-6',
      promptHash: 'ab12cd34',
      promptText: 'prompt',
      temperature: 1.0,
      corpusVersion: 'abc',
      plannedReps: 1,
      createdAt: CREATED_AT,
    });

    writeRepScores(runDir, 1, [
      scoreRow({ repIndex: 1, fixtureId: 'a' }),
      scoreRow({ repIndex: 1, fixtureId: 'b' }),
    ]);
    // Only "a" is vouched for this rep, even though "b" has rows on disk.
    vouch(runDir, { index: 1, fixtureIds: ['a'] });

    const { rows, exclusions } = readVouchedRows(runDir);

    expect(rows).toHaveLength(1);
    expect(rows[0].fixtureId).toBe('a');
    expect(
      exclusions.some((e) => e.includes('"b"') && e.includes('dropped')),
    ).toBe(true);
  });

  it('returns empty rows and no exclusions for a run with zero vouched reps', () => {
    const runDir = createRunDirectory({
      root,
      model: 'claude-sonnet-4-6',
      promptHash: 'ab12cd34',
      promptText: 'prompt',
      temperature: 1.0,
      corpusVersion: 'abc',
      plannedReps: 1,
      createdAt: CREATED_AT,
    });

    const { rows, exclusions } = readVouchedRows(runDir);
    expect(rows).toEqual([]);
    expect(exclusions).toEqual([]);
  });
});
