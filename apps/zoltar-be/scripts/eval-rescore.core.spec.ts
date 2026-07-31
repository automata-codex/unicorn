import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fakeDiceRoll,
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from '../eval/checks/structural/test-helpers';
import { serializeTurnResult } from '../eval/runs/artifacts';
import { rescoreDir, scoresPath } from '../eval/runs/paths';
import { readRescoreRows } from '../eval/runs/scores';

import { runRescore } from './eval-rescore.core';

import type { EvalFixture } from '../eval/fixture.schema';
import type { ScoreRow } from '../eval/runs/scores';
import type { TurnExecutionResult } from '../eval/turn-result';
import type { AnthropicService } from '../src/anthropic/anthropic.service';
import type { RescoreDeps } from './eval-rescore.core';

const RESCORED_AT = new Date('2026-07-30T09:00:00.000Z');

/**
 * Every structural re-score must reach a verdict without an Anthropic call.
 * Throwing here rather than returning a canned message is the assertion:
 * a stray judge call in a structural-only pass would otherwise be invisible
 * and expensive at corpus scale.
 */
function refusingAnthropic(): AnthropicService {
  return {
    callMessages: vi.fn(() => {
      throw new Error('no Anthropic call expected in a structural re-score');
    }),
  } as unknown as AnthropicService;
}

function deps(anthropic: AnthropicService = refusingAnthropic()): RescoreDeps {
  return { anthropicService: anthropic, clock: () => RESCORED_AT };
}

/**
 * `UNAUDITABLE-MAPPING` needs no fixture-authored applicability and no
 * judged facts, so it exercises the orchestration without dragging in the
 * fixture-schema gate — this file is about the re-score pass, not about any
 * one checker.
 */
const FIXTURE_ID = 'turn01-unauditable-mapping';

function fixtureFile(): EvalFixture {
  return fakeFixture({
    id: FIXTURE_ID,
    tag: 'UNAUDITABLE-MAPPING',
    fixtureSchemaVersion: 1,
    assertion: {
      mode: 'structural',
      check: 'a narrative-selection roll must state its mapping up front',
    },
  });
}

/** A turn whose only roll states no mapping — `checkUnauditableMapping`
 * reads this as FAILED. */
function failingTurn(): TurnExecutionResult {
  return fakeTurnExecutionResult({
    gameEvents: [
      fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
      fakeDiceRoll({
        sequenceNumber: 2,
        purpose: 'rolling for environmental detail',
        notation: '1d6',
      }),
    ],
  });
}

interface RunDirOptions {
  /** Verdict written into the source `scores.jsonl`. */
  sourceVerdict?: ScoreRow['verdict'];
  sourceErrorMessage?: string;
  /** Skip writing `warden-output.json`, simulating a turn that errored. */
  omitArtifact?: boolean;
}

function scoreRow(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    runId: 'claude-sonnet-4-6__ab12cd34__2026-07-29T10-51-26Z',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1,
    corpusVersion: 'sourcecorpus',
    harnessVersion: 'source01',
    repIndex: 1,
    fixtureId: FIXTURE_ID,
    checkId: 'unauditable-mapping',
    tag: 'UNAUDITABLE-MAPPING',
    checkMode: 'structural',
    verdict: 'fail',
    artifactPath: `reps/001/${FIXTURE_ID}/warden-output.json`,
    durationMs: 3,
    recordedAt: '2026-07-29T10:52:00.000Z',
    ...overrides,
  };
}

describe('runRescore', () => {
  let root: string;
  let runDir: string;
  let fixturesDir: string;

  function buildRunDir(opts: RunDirOptions = {}): void {
    const repDirPath = join(runDir, 'reps', '001');
    mkdirSync(join(repDirPath, FIXTURE_ID), { recursive: true });

    writeFileSync(
      join(runDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        runId: 'claude-sonnet-4-6__ab12cd34__2026-07-29T10-51-26Z',
        model: 'claude-sonnet-4-6',
        promptHash: 'ab12cd34',
        temperature: 1,
        corpusVersion: 'sourcecorpus',
        createdAt: '2026-07-29T10:51:26.000Z',
        plannedReps: 1,
        completedReps: [
          {
            index: 1,
            harnessVersion: 'source01',
            rubricHashes: {},
            fixtureIds: [FIXTURE_ID],
            startedAt: '2026-07-29T10:51:26.000Z',
            completedAt: '2026-07-29T10:53:00.000Z',
          },
        ],
      }),
    );

    writeFileSync(
      scoresPath(runDir, 1),
      JSON.stringify(
        scoreRow({
          verdict: opts.sourceVerdict ?? 'fail',
          errorMessage: opts.sourceErrorMessage,
        }),
      ) + '\n',
    );

    if (!opts.omitArtifact) {
      writeFileSync(
        join(repDirPath, FIXTURE_ID, 'warden-output.json'),
        serializeTurnResult(failingTurn()) + '\n',
      );
    }
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rescore-'));
    runDir = join(root, 'run');
    fixturesDir = join(root, 'fixtures');
    mkdirSync(runDir, { recursive: true });
    mkdirSync(fixturesDir, { recursive: true });
    writeFileSync(
      join(fixturesDir, `${FIXTURE_ID}.json`),
      JSON.stringify(fixtureFile()),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes rows to rescore/<timestamp>.jsonl and never touches reps/', async () => {
    buildRunDir();
    const scoresBefore = readFileSync(scoresPath(runDir, 1), 'utf-8');

    const summary = await runRescore({ runDir, fixturesDir }, deps());

    expect(summary.outputPath).toBe(
      join(rescoreDir(runDir), '2026-07-30T09-00-00Z.jsonl'),
    );
    expect(existsSync(summary.outputPath)).toBe(true);
    expect(readRescoreRows(summary.outputPath)).toHaveLength(1);
    // The source of truth for the run's own rates is untouched — the whole
    // reason this writes beside `reps/` rather than into it.
    expect(readFileSync(scoresPath(runDir, 1), 'utf-8')).toBe(scoresBefore);
  });

  it('reports no deltas when the current checkers reproduce the run exactly', async () => {
    buildRunDir({ sourceVerdict: 'fail' });

    const summary = await runRescore({ runDir, fixturesDir }, deps());

    expect(summary.rows[0].verdict).toBe('fail');
    expect(summary.deltas.every((d) => d.changedVerdicts === 0)).toBe(true);
  });

  it('names the transition and the rate move when a verdict changes', async () => {
    // Stands in for "the checker changed": the frozen artifact now grades
    // differently than the row on disk says it did.
    buildRunDir({ sourceVerdict: 'pass' });

    const summary = await runRescore({ runDir, fixturesDir }, deps());

    const delta = summary.deltas.find((d) => d.fixtureId === FIXTURE_ID);
    expect(delta?.changedVerdicts).toBe(1);
    expect(delta?.transitions).toEqual([
      { from: 'pass', to: 'fail', count: 1 },
    ]);
    expect(delta?.sourceRate).toBe(1);
    expect(delta?.rescoredRate).toBe(0);
  });

  it('stamps re-score-time corpus and harness versions, keeping the source ones alongside', async () => {
    buildRunDir();

    const summary = await runRescore({ runDir, fixturesDir }, deps());
    const row = summary.rows[0];

    expect(row.corpusVersion).toBe(summary.corpusVersion);
    expect(row.corpusVersion).not.toBe('sourcecorpus');
    expect(row.sourceCorpusVersion).toBe('sourcecorpus');
    expect(row.sourceHarnessVersion).toBe('source01');
    expect(row.harnessVersion).toBe(summary.harnessVersion);
    // Generation-side identity is copied from the manifest, not recomputed.
    expect(row.model).toBe('claude-sonnet-4-6');
    expect(row.promptHash).toBe('ab12cd34');
  });

  it('records where the check gets its applicability, and whether a judge ran', async () => {
    buildRunDir();

    const summary = await runRescore({ runDir, fixturesDir }, deps());
    const row = summary.rows[0];

    // `unauditable-mapping` gates on the turn's own output, which is the
    // label that marks a denominator as outcome-selected.
    expect(row.applicabilitySource).toBe('artifact');
    expect(row.judgeInvoked).toBe(false);
  });

  it('carries an un-regradable row forward instead of dropping it', async () => {
    // No `warden-output.json` — the original turn errored before writing
    // one, so there is nothing to re-grade and never will be. Dropping the
    // row would make the re-scored report look cleaner than the run.
    buildRunDir({
      omitArtifact: true,
      sourceVerdict: 'error',
      sourceErrorMessage: 'inner tool loop hit its 20-iteration cap',
    });

    const summary = await runRescore({ runDir, fixturesDir }, deps());

    expect(summary.carriedForward).toBe(1);
    expect(summary.rows).toHaveLength(1);
    const row = summary.rows[0];
    expect(row.carriedForward).toBe(true);
    expect(row.verdict).toBe('error');
    expect(row.errorMessage).toBe('inner tool loop hit its 20-iteration cap');
    // No checker ran, so claiming the re-score's harness version would
    // assert a measurement that never happened.
    expect(row.harnessVersion).toBe('source01');
    expect(summary.exclusions.errorsByMessage).toEqual([
      { message: 'inner tool loop hit its 20-iteration cap', count: 1 },
    ]);
  });

  it('honours a fixture filter', async () => {
    buildRunDir();

    const summary = await runRescore(
      { runDir, fixturesDir, fixtureIds: ['some-other-fixture'] },
      deps(),
    );

    expect(summary.rows).toHaveLength(0);
    expect(summary.deltas).toHaveLength(0);
  });

  it('reaches a structural verdict with no Anthropic call at all', async () => {
    buildRunDir();
    const anthropic = refusingAnthropic();

    const summary = await runRescore({ runDir, fixturesDir }, deps(anthropic));

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].verdict).toBe('fail');
    expect(anthropic.callMessages).not.toHaveBeenCalled();
  });
});
