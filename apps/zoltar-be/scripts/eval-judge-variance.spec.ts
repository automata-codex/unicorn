import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { evalChecks } from '../eval/checks/registry';
import { fakeTurnExecutionResult } from '../eval/checks/structural/test-helpers';
import { writeFixtureArtifacts } from '../eval/runs/artifacts';
import { envOnlyConfigService } from '../eval/runs/env-config-service';
import { appendCompletedRep, createRunDirectory } from '../eval/runs/manifest';
import { repDir, scoresPath } from '../eval/runs/paths';
import { ScoreWriter } from '../eval/runs/scores';
import { AnthropicService } from '../src/anthropic/anthropic.service';

import { runJudgeVariance } from './eval-judge-variance.core';

import type Anthropic from '@anthropic-ai/sdk';

const SEEDED_STATE = {
  campaignState: {},
  gmContextBlob: {},
  pendingCanon: [],
  messages: [],
  pendingDiceRequests: [],
  capturedAt: '2026-07-15T00:00:00.000Z',
};

const JUDGED_FIXTURE_ID = 'turn24-hidden-info-leak';
const STRUCTURAL_FIXTURE_ID = 'turn19-out-of-order-resolution';

function writeFixtureFiles(dir: string): void {
  writeFileSync(
    join(dir, `${JUDGED_FIXTURE_ID}.json`),
    JSON.stringify({
      id: JUDGED_FIXTURE_ID,
      tag: 'HIDDEN-INFO-LEAK',
      sourceAdventureId: '00000000-0000-0000-0000-000000000001',
      sourceSequenceNumber: 24,
      seededState: SEEDED_STATE,
      playerInput: { type: 'message', content: 'I search the room.' },
      assertion: {
        mode: 'judged',
        rubric: 'HIDDEN-INFO-LEAK',
        facts: { perceptionBoundary: 'the player can only see the airlock.' },
      },
    }),
  );
  writeFileSync(
    join(dir, `${STRUCTURAL_FIXTURE_ID}.json`),
    JSON.stringify({
      id: STRUCTURAL_FIXTURE_ID,
      tag: 'OUT-OF-ORDER-RESOLUTION',
      sourceAdventureId: '00000000-0000-0000-0000-000000000002',
      sourceSequenceNumber: 19,
      seededState: SEEDED_STATE,
      playerInput: { type: 'message', content: 'I fire at the xenomorph.' },
      assertion: {
        mode: 'structural',
        check: 'no damage roll before to-hit roll resolves',
      },
    }),
  );
}

function toolUseMessage(input: unknown): Anthropic.Message {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_fake',
        name: 'judge_verdict',
        input,
      } as unknown as Anthropic.ToolUseBlock,
    ],
  } as unknown as Anthropic.Message;
}

function fakeAnthropic(
  callMessages: ReturnType<typeof vi.fn>,
): AnthropicService {
  return { callMessages } as unknown as AnthropicService;
}

/** Builds a fabricated, vouched run directory: one rep, one judged
 * fixture and one structural fixture, both with a real warden-output.json
 * and a scores.jsonl row. Real Part 1–4 primitives build it, so it's
 * representative of what `eval:run` actually produces. */
async function buildFabricatedRun(evalRoot: string): Promise<string> {
  const runDir = createRunDirectory({
    root: evalRoot,
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    promptText: 'prompt',
    temperature: 1.0,
    corpusVersion: 'abc',
    assemblyHash: 'a55e3b19',
    plannedReps: 1,
    createdAt: new Date('2026-07-26T14:32:10.000Z'),
  });

  writeFixtureArtifacts(runDir, 1, JUDGED_FIXTURE_ID, {
    wardenRequests: [],
    turnResult: fakeTurnExecutionResult(),
  });

  mkdirSync(repDir(runDir, 1), { recursive: true });
  const writer = new ScoreWriter();
  writer.open(scoresPath(runDir, 1));
  writer.append({
    runId: 'run-1',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1.0,
    corpusVersion: 'abc',
    harnessVersion: 'abc1234',
    repIndex: 1,
    fixtureId: JUDGED_FIXTURE_ID,
    checkId: 'hidden-info-leak',
    tag: 'HIDDEN-INFO-LEAK',
    checkMode: 'judged',
    verdict: 'fail',
    rubricHash: 'deadbeef',
    artifactPath: `reps/001/${JUDGED_FIXTURE_ID}/judge-hidden-info-leak.json`,
    durationMs: 1,
    recordedAt: '2026-07-26T14:33:00.000Z',
  });
  writer.append({
    runId: 'run-1',
    model: 'claude-sonnet-4-6',
    promptHash: 'ab12cd34',
    temperature: 1.0,
    corpusVersion: 'abc',
    harnessVersion: 'abc1234',
    repIndex: 1,
    fixtureId: STRUCTURAL_FIXTURE_ID,
    checkId: 'out-of-order-resolution',
    tag: 'OUT-OF-ORDER-RESOLUTION',
    checkMode: 'structural',
    verdict: 'pass',
    artifactPath: `reps/001/${STRUCTURAL_FIXTURE_ID}/warden-output.json`,
    durationMs: 1,
    recordedAt: '2026-07-26T14:33:01.000Z',
  });
  await writer.close();

  appendCompletedRep(runDir, {
    index: 1,
    harnessVersion: 'abc1234',
    rubricHashes: { 'hidden-info-leak': 'deadbeef' },
    fixtureIds: [JUDGED_FIXTURE_ID, STRUCTURAL_FIXTURE_ID],
    startedAt: '2026-07-26T14:33:00.000Z',
    completedAt: '2026-07-26T14:34:00.000Z',
  });

  return runDir;
}

describe('runJudgeVariance', () => {
  let evalRoot: string;
  let fixturesDir: string;
  let runDir: string;

  beforeEach(async () => {
    evalRoot = mkdtempSync(join(tmpdir(), 'eval-jv-root-'));
    fixturesDir = mkdtempSync(join(tmpdir(), 'eval-jv-fixtures-'));
    writeFixtureFiles(fixturesDir);
    runDir = await buildFabricatedRun(evalRoot);
  });

  afterEach(() => {
    rmSync(evalRoot, { recursive: true, force: true });
    rmSync(fixturesDir, { recursive: true, force: true });
  });

  it('a deterministic judge yields a zero flip rate', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage({ passed: true, rationale: 'fine' }));

    const summary = await runJudgeVariance(
      { runDir, fixturesDir, trials: 4 },
      {
        anthropicService: fakeAnthropic(callMessages),
        clock: () => new Date('2026-07-26T15:00:00.000Z'),
      },
    );

    expect(callMessages).toHaveBeenCalledTimes(4);
    const [fc] = summary.byFixtureCheck;
    expect(fc.fixtureId).toBe(JUDGED_FIXTURE_ID);
    expect(fc.flipRate).toBe(0);
    expect(fc.verdictCounts).toEqual({ pass: 4 });
    expect(summary.headlines[0]).toMatch(/flipped on 0 of 1 frozen inputs/);
  });

  it('a judge scripted to alternate yields the expected flip rate and distribution', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValueOnce(toolUseMessage({ passed: true, rationale: 'a' }))
      .mockResolvedValueOnce(toolUseMessage({ passed: false, rationale: 'b' }))
      .mockResolvedValueOnce(toolUseMessage({ passed: true, rationale: 'c' }))
      .mockResolvedValueOnce(toolUseMessage({ passed: false, rationale: 'd' }));

    const summary = await runJudgeVariance(
      { runDir, fixturesDir, trials: 4 },
      {
        anthropicService: fakeAnthropic(callMessages),
        clock: () => new Date('2026-07-26T15:00:00.000Z'),
      },
    );

    const [fc] = summary.byFixtureCheck;
    expect(fc.flipRate).toBe(1);
    expect(fc.verdictCounts).toEqual({ pass: 2, fail: 2 });
    expect(summary.headlines[0]).toMatch(/flipped on 1 of 1 frozen inputs/);
  });

  it("persists each trial's rationale and the contract it was graded under", async () => {
    // The flip rate answers "does the grader agree with itself". It cannot
    // answer "does the grader agree with its own reasoning" — a different
    // defect, and the one this corpus actually has: six verdicts in 1,341
    // contradict their own rationale. Reading one artifact against itself is
    // the only reliable detector, and this command used to discard the half
    // you need for it.
    const callMessages = vi
      .fn()
      .mockResolvedValueOnce(
        toolUseMessage({ passed: false, rationale: 'no leak here at all' }),
      )
      .mockResolvedValueOnce(
        toolUseMessage({ passed: true, rationale: 'clean' }),
      );

    const summary = await runJudgeVariance(
      { runDir, fixturesDir, trials: 2 },
      {
        anthropicService: fakeAnthropic(callMessages),
        clock: () => new Date('2026-07-26T15:00:00.000Z'),
      },
    );

    expect(summary.rows.map((r) => r.rationale)).toEqual([
      'no leak here at all',
      'clean',
    ]);
    // Both variance files in a before/after study must be distinguishable by
    // contract from their contents alone, not from filename or ordering.
    expect(
      summary.rows.every((r) => /^[0-9a-f]{8}$/.test(r.judgeContractHash)),
    ).toBe(true);
  });

  it('excludes gate-settled inputs from the flip-rate denominator, and names them', async () => {
    // A `judgeGate` that settles a rep structurally produces a verdict that
    // is deterministic over fixed input by construction. Counting it as a
    // frozen input that "didn't flip" would pull the measured flip rate
    // toward zero — flattering the very rubric this command exists to be
    // suspicious of. No check ships a gate yet (the first arrives with
    // `unauditable-mapping`), so one is installed here.
    const check = evalChecks['hidden-info-leak'];
    const originalGate = check.judgeGate;
    check.judgeGate = () => ({
      outcome: 'NOT_APPLICABLE',
      actual: 'the structural pre-filter settled this rep',
    });

    try {
      const callMessages = vi.fn();
      const summary = await runJudgeVariance(
        { runDir, fixturesDir, trials: 4 },
        {
          anthropicService: fakeAnthropic(callMessages),
          clock: () => new Date('2026-07-26T15:00:00.000Z'),
        },
      );

      expect(callMessages).not.toHaveBeenCalled();

      const [fc] = summary.byFixtureCheck;
      // Nothing reached the rubric, so there is no evidence about it at all
      // — a 0.00 flip rate here would be a claim, not a measurement.
      expect(fc.totalInputs).toBe(0);
      expect(fc.gatedInputs).toBe(1);
      expect(fc.flipRate).toBeNull();
      // Verdict counts stay inclusive — they describe what the check did.
      expect(fc.verdictCounts).toEqual({ not_applicable: 4 });
      expect(summary.headlines[0]).toMatch(
        /1 further input\(s\) settled by the structural gate, never reaching the rubric/,
      );
      // A gated row asserts no rubric graded it. Back-filling the check's
      // hash here would contradict `judgeInvoked: false` on the same row —
      // found on 33 real rows before this was fixed.
      expect(summary.rows.every((r) => r.rubricHash === '')).toBe(true);
      expect(summary.rows.every((r) => r.judgeInvoked === false)).toBe(true);
    } finally {
      check.judgeGate = originalGate;
    }
  });

  it('skips structural checks and reports them as skipped', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage({ passed: true, rationale: 'fine' }));

    const summary = await runJudgeVariance(
      { runDir, fixturesDir, trials: 2 },
      {
        anthropicService: fakeAnthropic(callMessages),
        clock: () => new Date('2026-07-26T15:00:00.000Z'),
      },
    );

    const skipped = summary.skipped.find(
      (s) => s.fixtureId === STRUCTURAL_FIXTURE_ID,
    );
    expect(skipped).toBeDefined();
    expect(skipped!.reason).toMatch(/deterministic over fixed input/);
    // No rows generated for the structural fixture.
    expect(
      summary.rows.some((r) => r.fixtureId === STRUCTURAL_FIXTURE_ID),
    ).toBe(false);
  });

  it('writes output under judge-variance/, never reps/, and leaves scores.jsonl byte-unchanged', async () => {
    const scoresFile = scoresPath(runDir, 1);
    const before = readFileSync(scoresFile);
    const repFilesBefore = new Set(readdirSync(join(runDir, 'reps', '001')));

    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage({ passed: true, rationale: 'fine' }));

    const summary = await runJudgeVariance(
      { runDir, fixturesDir, trials: 2 },
      {
        anthropicService: fakeAnthropic(callMessages),
        clock: () => new Date('2026-07-26T15:00:00.000Z'),
      },
    );

    expect(summary.outputPath.startsWith(join(runDir, 'judge-variance'))).toBe(
      true,
    );
    expect(existsSync(summary.outputPath)).toBe(true);

    const after = readFileSync(scoresFile);
    expect(after.equals(before)).toBe(true);

    const repFilesAfter = new Set(readdirSync(join(runDir, 'reps', '001')));
    expect(repFilesAfter).toEqual(repFilesBefore);
  });

  it('emits input-start, one trial-done per trial, and a skipped event for the structural fixture', async () => {
    const callMessages = vi
      .fn()
      .mockResolvedValue(toolUseMessage({ passed: true, rationale: 'fine' }));

    const events: string[] = [];
    await runJudgeVariance(
      {
        runDir,
        fixturesDir,
        trials: 2,
        onProgress: (event) => {
          if (event.type === 'input-start') {
            events.push(`input-start:${event.fixtureId}`);
          } else if (event.type === 'trial-done') {
            events.push(
              `trial-done:${event.fixtureId}:${event.trialIndex}/${event.totalTrials}:${event.verdict}`,
            );
          } else {
            events.push(`skipped:${event.fixtureId}`);
          }
        },
      },
      {
        anthropicService: fakeAnthropic(callMessages),
        clock: () => new Date('2026-07-26T15:00:00.000Z'),
      },
    );

    expect(events).toContain(`skipped:${STRUCTURAL_FIXTURE_ID}`);
    expect(events).toContain(`input-start:${JUDGED_FIXTURE_ID}`);
    expect(events).toContain(`trial-done:${JUDGED_FIXTURE_ID}:1/2:pass`);
    expect(events).toContain(`trial-done:${JUDGED_FIXTURE_ID}:2/2:pass`);
    // input-start precedes both of the judged fixture's trials.
    const inputStartIndex = events.indexOf(`input-start:${JUDGED_FIXTURE_ID}`);
    expect(inputStartIndex).toBeLessThan(
      events.indexOf(`trial-done:${JUDGED_FIXTURE_ID}:1/2:pass`),
    );
  });
});

const RUN_LIVE = process.env.RUN_LIVE_EVAL_TESTS === '1';

try {
  process.loadEnvFile();
} catch {
  // No .env file found — rely on whatever's already in process.env.
}

describe.skipIf(!RUN_LIVE)(
  'runJudgeVariance — LIVE Sonnet 5 calls (gated by RUN_LIVE_EVAL_TESTS=1)',
  () => {
    let evalRoot: string;
    let fixturesDir: string;
    let runDir: string;

    beforeEach(async () => {
      evalRoot = mkdtempSync(join(tmpdir(), 'eval-jv-live-root-'));
      fixturesDir = mkdtempSync(join(tmpdir(), 'eval-jv-live-fixtures-'));
      writeFixtureFiles(fixturesDir);
      runDir = await buildFabricatedRun(evalRoot);
    });

    afterEach(() => {
      rmSync(evalRoot, { recursive: true, force: true });
      rmSync(fixturesDir, { recursive: true, force: true });
    });

    it('runs real judge calls against the HIDDEN-INFO-LEAK rubric and produces a coherent summary', async () => {
      const anthropicService = new AnthropicService(envOnlyConfigService());

      const summary = await runJudgeVariance(
        { runDir, fixturesDir, trials: 2 },
        { anthropicService, clock: () => new Date() },
      );

      expect(summary.rows).toHaveLength(2);
      expect(summary.rows.every((r) => r.checkId === 'hidden-info-leak')).toBe(
        true,
      );
      expect(summary.byFixtureCheck).toHaveLength(1);
      expect(summary.byFixtureCheck[0].flipRate).not.toBeNull();
      expect(summary.headlines[0]).toMatch(
        /^rubric hidden-info-leak \(\w+\) flipped on \d+ of 1 frozen inputs$/,
      );
    }, 60_000);
  },
);
