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

import { universalCheckIds } from '../eval/checks/registry';
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
 * A structural check, so the whole re-score pass runs without an Anthropic
 * call — this file is about the orchestration, not about any one checker.
 * `system-rolled-player-action` also carries fixture-authored applicability,
 * which lets the `applicabilitySource` column be asserted meaningfully.
 */
const FIXTURE_ID = 'turn19-system-rolled-player-action';

function fixtureFile(): EvalFixture {
  return fakeFixture({
    id: FIXTURE_ID,
    tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
    applicability: {
      'system-rolled-player-action': {
        applies: true,
        playerEntity: 'Alvarez',
        situation: 'Alvarez declares an attack requiring a Combat roll.',
      },
    },
    assertion: {
      mode: 'structural',
      check: "Alvarez's damage roll must be deferred, not resolved system-side",
    },
  });
}

/** A turn that resolves the player's own roll system-side — read as FAILED. */
function failingTurn(): TurnExecutionResult {
  return fakeTurnExecutionResult({
    gameEvents: [
      fakeGameEvent({ sequenceNumber: 1, eventType: 'player_action' }),
      fakeDiceRoll({
        sequenceNumber: 2,
        purpose: 'Alvarez rifle damage if her attack hits',
        notation: '1d10',
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
    checkId: 'system-rolled-player-action',
    tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
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
    expect(readRescoreRows(summary.outputPath)).toHaveLength(
      1 + universalCheckIds.length,
    );
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

  it('records a null sourceVerdict for a check with no row in the source run', async () => {
    // The universal check has no row in the source scores file, which is the
    // shape every newly attached check arrives in. Until 2026-08-28 the
    // fallback copied the *re-scored* verdict into `sourceVerdict`, so a
    // first-ever measurement was recorded as an unchanged one — contradicting
    // the warning this same pass emits for it.
    buildRunDir({ sourceVerdict: 'fail' });

    const summary = await runRescore({ runDir, fixturesDir }, deps());

    const tagRow = summary.rows.find(
      (r) => r.checkId === 'system-rolled-player-action',
    );
    expect(tagRow?.sourceVerdict).toBe('fail');

    for (const checkId of universalCheckIds) {
      const row = summary.rows.find((r) => r.checkId === checkId);
      expect(row, `no row for universal check ${checkId}`).toBeDefined();
      expect(row?.sourceVerdict).toBe(null);
      // And the row is still a real measurement — null on the source side
      // says nothing about whether this pass graded it.
      expect(row?.verdict).toBeDefined();
      expect(row?.carriedForward).toBe(false);
    }
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

    // `system-rolled-player-action` reads fixture-authored applicability, so
    // its denominator is fixed before the model runs.
    expect(row.applicabilitySource).toBe('fixture');
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
    // One row in, one row out: rescore regrades the rows a frozen run
    // recorded, and never invents rows for checks that run did not have.
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

    expect(summary.rows).toHaveLength(1 + universalCheckIds.length);
    expect(summary.rows[0].verdict).toBe('fail');
    expect(anthropic.callMessages).not.toHaveBeenCalled();
  });
});

describe('runRescore — judged rows keep their reasoning', () => {
  let root: string;
  let runDir: string;
  let fixturesDir: string;
  const JUDGED_ID = 'turn24-scene-jump';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rescore-judged-'));
    runDir = join(root, 'run');
    fixturesDir = join(root, 'fixtures');
    mkdirSync(join(runDir, 'reps', '001', JUDGED_ID), { recursive: true });
    mkdirSync(fixturesDir, { recursive: true });

    writeFileSync(
      join(fixturesDir, `${JUDGED_ID}.json`),
      JSON.stringify(
        fakeFixture({
          id: JUDGED_ID,
          tag: 'SCENE-JUMP',
          assertion: {
            mode: 'judged',
            rubric: 'SCENE-JUMP',
            facts: { expectedScope: 'the airlock, this moment' },
          },
        }),
      ),
    );
    writeFileSync(
      join(runDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        runId: 'r',
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
            fixtureIds: [JUDGED_ID],
            startedAt: 'x',
            completedAt: 'y',
          },
        ],
      }),
    );
    writeFileSync(
      scoresPath(runDir, 1),
      `${JSON.stringify(
        scoreRow({
          fixtureId: JUDGED_ID,
          checkId: 'scene-jump',
          tag: 'SCENE-JUMP',
          checkMode: 'judged',
          verdict: 'pass',
          // What the ORIGINAL run recorded: a judge artifact holding the
          // rationale of whatever rubric was current then.
          artifactPath: `reps/001/${JUDGED_ID}/judge-scene-jump.json`,
        }),
      )}\n`,
    );
    writeFileSync(
      join(runDir, 'reps', '001', JUDGED_ID, 'warden-output.json'),
      `${serializeTurnResult(fakeTurnExecutionResult())}\n`,
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the new rationale beside the pass and points the row at it', async () => {
    const anthropic = {
      callMessages: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 't',
            name: 'judge_verdict',
            input: { passed: false, rationale: 'relocated the PC to the bay' },
          },
        ],
      }),
    } as unknown as AnthropicService;

    const summary = await runRescore(
      { runDir, fixturesDir },
      { anthropicService: anthropic, clock: () => RESCORED_AT },
    );

    const row = summary.rows[0];
    expect(row.verdict).toBe('fail');

    // Not the source row's path. That file holds the original rubric's
    // reasoning for a different verdict; citing it would attribute one
    // rubric's rationale to another's conclusion.
    expect(row.artifactPath).not.toMatch(/^reps\//);
    expect(row.artifactPath).toBe(
      join(
        'rescore',
        '2026-07-30T09-00-00Z',
        '001',
        JUDGED_ID,
        'judge-scene-jump.json',
      ),
    );

    const written = JSON.parse(
      readFileSync(join(runDir, row.artifactPath), 'utf-8'),
    ) as { verdict: string; rationale: string };
    expect(written.verdict).toBe('fail');
    expect(written.rationale).toBe('relocated the PC to the bay');

    // The original run's artifact is untouched — it is the record of what
    // that run was scored against.
    expect(
      existsSync(
        join(runDir, 'reps', '001', JUDGED_ID, 'judge-scene-jump.json'),
      ),
    ).toBe(false);
  });
});
