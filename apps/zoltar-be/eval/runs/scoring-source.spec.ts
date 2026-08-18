import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendCompletedRep, createRunDirectory } from './manifest';
import { rescoreDir, scoresPath } from './paths';
import {
  listRescorePasses,
  parseScoringArg,
  resolveScoring,
  ScoringSourceError,
} from './scoring-source';

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

function rescoreRow(overrides: Partial<RescoreRow> = {}): RescoreRow {
  return {
    ...scoreRow(),
    rowKind: 'rescore',
    rescoredAt: '2026-07-30T09:00:00.000Z',
    sourceCorpusVersion: 'abc',
    sourceHarnessVersion: 'abc1234',
    sourceVerdict: 'fail',
    carriedForward: false,
    ...overrides,
  };
}

describe('scoring-source', () => {
  let root: string;
  let runDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eval-scoring-'));
    runDir = createRunDirectory({
      root,
      model: 'claude-sonnet-4-6',
      promptHash: 'ab12cd34',
      temperature: 1,
      corpusVersion: 'abc',
      assemblyHash: 'a55e3b19',
      createdAt: CREATED_AT,
      plannedReps: 1,
      promptText: 'you are the warden',
    });

    mkdirSync(join(runDir, 'reps', '001'), { recursive: true });
    writeFileSync(
      scoresPath(runDir, 1),
      `${JSON.stringify(scoreRow())}\n`,
      'utf-8',
    );
    appendCompletedRep(runDir, {
      index: 1,
      harnessVersion: 'abc1234',
      rubricHashes: {},
      fixtureIds: ['turn19-out-of-order-resolution'],
      startedAt: '2026-07-26T14:33:00.000Z',
      completedAt: '2026-07-26T14:34:00.000Z',
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeRescorePass(timestamp: string, rows: RescoreRow[]): void {
    mkdirSync(rescoreDir(runDir), { recursive: true });
    writeFileSync(
      join(rescoreDir(runDir), `${timestamp}.jsonl`),
      rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf-8',
    );
  }

  describe('listRescorePasses', () => {
    it('returns nothing when the run has never been re-scored', () => {
      expect(listRescorePasses(runDir)).toEqual([]);
    });

    it('lists passes oldest first', () => {
      writeRescorePass('2026-08-01T09-00-00Z', [rescoreRow()]);
      writeRescorePass('2026-07-30T09-00-00Z', [rescoreRow()]);

      expect(listRescorePasses(runDir).map((p) => p.timestamp)).toEqual([
        '2026-07-30T09-00-00Z',
        '2026-08-01T09-00-00Z',
      ]);
    });

    it('ignores the judge-rationale directory a pass writes alongside itself', () => {
      // `rescoreJudgeArtifactPath` puts rationales in a directory named for
      // the same timestamp. Counting it would produce a phantom pass with no
      // rows behind it.
      writeRescorePass('2026-07-30T09-00-00Z', [rescoreRow()]);
      mkdirSync(join(rescoreDir(runDir), '2026-07-30T09-00-00Z', '001'), {
        recursive: true,
      });

      expect(listRescorePasses(runDir)).toHaveLength(1);
    });
  });

  describe('resolveScoring', () => {
    it('reads the run own vouched rows for --scoring run', () => {
      writeRescorePass('2026-07-30T09-00-00Z', [rescoreRow()]);

      const resolved = resolveScoring(runDir, { kind: 'run' });

      expect(resolved.kind).toBe('run');
      expect(resolved.rows).toHaveLength(1);
      expect(resolved.defaultedToRescore).toBe(false);
      // Even with a re-score sitting right there, an explicit --scoring run
      // reads reps/.
      expect(resolved.source).toContain('scores.jsonl');
    });

    it('defaults to the most recent re-score, flagged as a default', () => {
      writeRescorePass('2026-07-30T09-00-00Z', [rescoreRow()]);
      writeRescorePass('2026-08-01T09-00-00Z', [
        rescoreRow({ harnessVersion: 'def5678' }),
        rescoreRow({ repIndex: 2, carriedForward: true }),
      ]);

      const resolved = resolveScoring(runDir, { kind: 'auto' });

      expect(resolved.kind).toBe('rescore');
      expect(resolved.label).toBe('re-score 2026-08-01T09-00-00Z');
      expect(resolved.rows).toHaveLength(2);
      expect(resolved.carriedForward).toBe(1);
      expect(resolved.defaultedToRescore).toBe(true);
    });

    it('falls back to the run when there is nothing to default to', () => {
      const resolved = resolveScoring(runDir, { kind: 'auto' });

      expect(resolved.kind).toBe('run');
      expect(resolved.defaultedToRescore).toBe(false);
    });

    it('does not flag an explicitly requested re-score as a default', () => {
      writeRescorePass('2026-07-30T09-00-00Z', [rescoreRow()]);

      expect(
        resolveScoring(runDir, { kind: 'latest-rescore' }).defaultedToRescore,
      ).toBe(false);
    });

    it('throws, naming the available passes, for an unknown timestamp', () => {
      writeRescorePass('2026-07-30T09-00-00Z', [rescoreRow()]);

      expect(() =>
        resolveScoring(runDir, { kind: 'rescore', timestamp: 'nope' }),
      ).toThrow(/Available: 2026-07-30T09-00-00Z/);
    });

    it('throws rather than silently falling back when --scoring rescore has no passes', () => {
      expect(() => resolveScoring(runDir, { kind: 'latest-rescore' })).toThrow(
        ScoringSourceError,
      );
    });

    it('computes the harness version from re-graded rows only', () => {
      // A carried-forward row keeps the source run's harness stamp because
      // nothing re-graded it. Folding it into `harnessVersion` is what made
      // two identically-graded re-scores look like different graders.
      writeRescorePass('2026-07-30T09-00-00Z', [
        rescoreRow({ repIndex: 1, harnessVersion: '600cc73' }),
        rescoreRow({ repIndex: 2, harnessVersion: '600cc73' }),
        rescoreRow({
          repIndex: 3,
          harnessVersion: 'fa1d801',
          carriedForward: true,
        }),
      ]);

      const resolved = resolveScoring(runDir, { kind: 'latest-rescore' });

      expect(resolved.harnessVersion).toBe('600cc73');
      expect(resolved.carriedForward).toBe(1);
      // Reported, so the count and its provenance are visible — just never
      // compared across sides as if it graded this pass.
      expect(resolved.carriedForwardHarnessVersion).toBe('fa1d801');
    });

    it('reports the corpus and harness versions the re-score rows carry', () => {
      writeRescorePass('2026-07-30T09-00-00Z', [
        rescoreRow({ corpusVersion: 'later', harnessVersion: 'def5678' }),
      ]);

      const resolved = resolveScoring(runDir, { kind: 'latest-rescore' });

      expect(resolved.corpusVersion).toBe('later');
      expect(resolved.harnessVersion).toBe('def5678');
    });

    it('refuses to read a scores.jsonl as a re-score pass', () => {
      // The two files are the same shape; `rowKind` is what keeps a run's
      // verdicts out of a re-score denominator and vice versa.
      mkdirSync(rescoreDir(runDir), { recursive: true });
      writeFileSync(
        join(rescoreDir(runDir), '2026-07-30T09-00-00Z.jsonl'),
        `${JSON.stringify(scoreRow())}\n`,
        'utf-8',
      );

      expect(() => resolveScoring(runDir, { kind: 'latest-rescore' })).toThrow(
        /rowKind/,
      );
    });
  });
});

describe('parseScoringArg', () => {
  it('treats an absent flag as auto', () => {
    expect(parseScoringArg(undefined)).toEqual({ kind: 'auto' });
  });

  it('parses run, rescore and rescore=<timestamp>', () => {
    expect(parseScoringArg('run')).toEqual({ kind: 'run' });
    expect(parseScoringArg('rescore')).toEqual({ kind: 'latest-rescore' });
    expect(parseScoringArg('rescore=2026-07-30T09-00-00Z')).toEqual({
      kind: 'rescore',
      timestamp: '2026-07-30T09-00-00Z',
    });
  });

  it('rejects an unrecognised selector rather than defaulting', () => {
    expect(() => parseScoringArg('reps')).toThrow(ScoringSourceError);
    expect(() => parseScoringArg('rescore=')).toThrow(/needs a timestamp/);
  });
});
