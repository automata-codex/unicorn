import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendCompletedRep, createRunDirectory } from './manifest';
import { repDir, scoresPath } from './paths';
import {
  RescoreWriter,
  readRescoreRows,
  readScoreRows,
  readVouchedRows,
  rescoreRowSchema,
  ScoreRowError,
  ScoreWriter,
  scoreRowSchema,
} from './scores';

import type { CompletedRep } from './manifest';
import type { RescoreRow, ScoreRow } from './scores';

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
            "the turn deferred Alvarez's gating roll to a pending dice_request " +
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

function rescoreRow(overrides: Partial<RescoreRow> = {}): RescoreRow {
  return {
    ...scoreRow(),
    rowKind: 'rescore',
    rescoredAt: '2026-07-30T09:00:00.000Z',
    sourceCorpusVersion: 'abc',
    sourceHarnessVersion: 'abc1234',
    sourceVerdict: 'pass',
    carriedForward: false,
    ...overrides,
  };
}

describe('rescoreRowSchema', () => {
  it('accepts a re-scored row', () => {
    expect(() => rescoreRowSchema.parse(rescoreRow())).not.toThrow();
  });

  it('carries the same verdict/detail obligations as a run row', () => {
    expect(() =>
      rescoreRowSchema.parse(rescoreRow({ verdict: 'not_applicable' })),
    ).toThrow(/notApplicableReason is required/);
    expect(() =>
      rescoreRowSchema.parse(rescoreRow({ verdict: 'error' })),
    ).toThrow(/errorMessage is required/);
  });

  it('records the source verdict independently of the re-scored one', () => {
    const parsed = rescoreRowSchema.parse(
      rescoreRow({ verdict: 'fail', sourceVerdict: 'pass' }),
    );
    expect(parsed.sourceVerdict).toBe('pass');
    expect(parsed.verdict).toBe('fail');
  });

  it('defaults carriedForward to false', () => {
    const { carriedForward: _omitted, ...withoutFlag } = rescoreRow();
    expect(rescoreRowSchema.parse(withoutFlag).carriedForward).toBe(false);
  });

  it('accepts a null source verdict, meaning there was no source row', () => {
    // The ordinary case for a check newly attached to a fixture. Until
    // 2026-08-28 the field was non-nullable and the fallback copied the
    // re-scored verdict, so a first-ever measurement was recorded as an
    // unchanged one.
    const parsed = rescoreRowSchema.parse(
      rescoreRow({ verdict: 'fail', sourceVerdict: null }),
    );
    expect(parsed.sourceVerdict).toBe(null);
    expect(parsed.verdict).toBe('fail');
  });

  it('still parses rows written before the field was nullable', () => {
    // Files on disk from before the fix carry a copied verdict rather than
    // null. They must keep loading — `eval:report` reads whole re-score
    // files, and a schema that rejected them would make older passes
    // unreadable rather than merely ambiguous.
    expect(() =>
      rescoreRowSchema.parse(rescoreRow({ sourceVerdict: 'pass' })),
    ).not.toThrow();
  });
});

describe('the two row kinds never read as each other', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rescore-rows-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('readScoreRows rejects a re-score file rather than folding it into a rate', () => {
    const path = join(dir, 'rescore.jsonl');
    writeFileSync(path, JSON.stringify(rescoreRow()) + '\n');

    expect(() => readScoreRows(path)).toThrow(ScoreRowError);
  });

  it('readRescoreRows rejects a run scores file', () => {
    const path = join(dir, 'scores.jsonl');
    writeFileSync(path, JSON.stringify(scoreRow()) + '\n');

    expect(() => readRescoreRows(path)).toThrow(ScoreRowError);
  });

  it('a run row keeps the on-disk format it always had — no rowKind written', async () => {
    // Deliberate: `eval:rescore` exists to reproduce historical numbers, so
    // the run writer's output must not change shape in the same commit.
    const path = join(dir, 'scores.jsonl');
    const writer = new ScoreWriter();
    writer.open(path);
    writer.append(scoreRow());
    await writer.close();

    const written = JSON.parse(readFileSync(path, 'utf-8').trim()) as Record<
      string,
      unknown
    >;
    expect('rowKind' in written).toBe(false);
  });

  it('RescoreWriter round-trips through readRescoreRows', async () => {
    const path = join(dir, 'rescore.jsonl');
    const writer = new RescoreWriter();
    writer.open(path);
    writer.append(rescoreRow({ verdict: 'fail', sourceVerdict: 'pass' }));
    writer.append(rescoreRow({ repIndex: 2, carriedForward: true }));
    await writer.close();

    const rows = readRescoreRows(path);
    expect(rows).toHaveLength(2);
    expect(rows[0].verdict).toBe('fail');
    expect(rows[0].sourceVerdict).toBe('pass');
    expect(rows[1].carriedForward).toBe(true);
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

  function vouch(
    runDir: string,
    entry: Partial<CompletedRep> & { index: number },
  ) {
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
      assemblyHash: 'a55e3b19',
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
    expect(
      exclusions.some((e) => e.includes('003') && e.includes('not vouched')),
    ).toBe(true);
  });

  it('drops rows for a fixture not in the vouched fixtureIds subset', () => {
    const runDir = createRunDirectory({
      root,
      model: 'claude-sonnet-4-6',
      promptHash: 'ab12cd34',
      promptText: 'prompt',
      temperature: 1.0,
      corpusVersion: 'abc',
      assemblyHash: 'a55e3b19',
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
      assemblyHash: 'a55e3b19',
      plannedReps: 1,
      createdAt: CREATED_AT,
    });

    const { rows, exclusions } = readVouchedRows(runDir);
    expect(rows).toEqual([]);
    expect(exclusions).toEqual([]);
  });
});
