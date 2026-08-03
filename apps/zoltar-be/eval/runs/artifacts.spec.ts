import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkSystemRolledPlayerAction } from '../checks/structural/system-rolled-player-action';
import {
  fakeDiceRequest,
  fakeFixture,
  fakeGameEvent,
  fakePendingCanon,
  fakeTurnExecutionResult,
} from '../checks/structural/test-helpers';

import {
  deserializeTurnResult,
  readTurnResultArtifact,
  relativeArtifactPath,
  serializeTurnResult,
  writeFixtureArtifacts,
  writeJudgeArtifact,
} from './artifacts';
import {
  fixtureArtifactDir,
  judgeArtifactPath,
  wardenOutputPath,
  wardenRequestPath,
} from './paths';

import type { TurnExecutionResult } from '../turn-result';

const APPLICABLE_FIXTURE = fakeFixture({
  tag: 'SYSTEM-ROLLED-PLAYER-ACTION',
  applicability: {
    'system-rolled-player-action': {
      applies: true,
      playerEntity: 'alvarez',
      situation: 'test fixture',
    },
  },
});

function buildResult(): TurnExecutionResult {
  return fakeTurnExecutionResult({
    campaignState: {
      resourcePools: { alvarez_hp: { current: 10, max: 10 } },
    },
    gameEvents: [
      fakeGameEvent({
        sequenceNumber: 1,
        eventType: 'dice_roll',
        createdAt: new Date('2026-07-15T01:00:00.000Z'),
        payload: {
          notation: '1d10',
          purpose: 'alvarez damage if hits',
          results: [5],
          modifier: 0,
          total: 5,
        },
      }),
    ],
    telemetry: {
      id: 'telemetry-1',
      adventureId: '00000000-0000-0000-0000-0000000000a1',
      sequenceNumber: 1,
      payload: {},
      createdAt: new Date('2026-07-15T02:00:00.000Z'),
    } as unknown as TurnExecutionResult['telemetry'],
    pendingCanon: [
      fakePendingCanon({
        summary: 'brig discovered',
        context: 'deck 2',
        createdAt: new Date('2026-07-15T03:00:00.000Z'),
        reviewedAt: new Date('2026-07-15T03:30:00.000Z'),
      }),
      fakePendingCanon({
        summary: 'unreviewed entry',
        context: 'deck 3',
        createdAt: new Date('2026-07-15T03:15:00.000Z'),
        reviewedAt: null,
      }),
    ],
    diceRequests: [
      fakeDiceRequest({
        notation: '1d10',
        purpose: 'search the room',
        createdAt: new Date('2026-07-15T04:00:00.000Z'),
        resolvedAt: new Date('2026-07-15T04:30:00.000Z'),
      }),
      fakeDiceRequest({
        notation: '1d10',
        purpose: 'unresolved',
        createdAt: new Date('2026-07-15T04:15:00.000Z'),
        resolvedAt: null,
      }),
    ],
  });
}

describe('serializeTurnResult / deserializeTurnResult', () => {
  it('revives every known date-bearing field to a real Date instance', () => {
    const original = buildResult();
    const revived = deserializeTurnResult(serializeTurnResult(original));

    expect(revived.gameEvents[0].createdAt).toBeInstanceOf(Date);
    expect(revived.gameEvents[0].createdAt.toISOString()).toBe(
      original.gameEvents[0].createdAt.toISOString(),
    );

    expect(revived.telemetry?.createdAt).toBeInstanceOf(Date);
    expect(revived.telemetry?.createdAt.toISOString()).toBe(
      original.telemetry?.createdAt.toISOString(),
    );

    expect(revived.pendingCanon[0].createdAt).toBeInstanceOf(Date);
    expect(revived.pendingCanon[0].reviewedAt).toBeInstanceOf(Date);
    expect(revived.pendingCanon[1].reviewedAt).toBeNull();

    expect(revived.diceRequests[0].createdAt).toBeInstanceOf(Date);
    expect(revived.diceRequests[0].resolvedAt).toBeInstanceOf(Date);
    expect(revived.diceRequests[1].resolvedAt).toBeNull();
  });

  it('preserves checker-visible equality: a structural checker returns the same verdict before and after the round-trip', () => {
    const original = buildResult();
    const revived = deserializeTurnResult(serializeTurnResult(original));

    const originalVerdict = checkSystemRolledPlayerAction(original, APPLICABLE_FIXTURE);
    const revivedVerdict = checkSystemRolledPlayerAction(revived, APPLICABLE_FIXTURE);

    expect(revivedVerdict).toEqual(originalVerdict);
    expect(revivedVerdict.outcome).toBe('FAILED');
  });

  it('round-trips a null telemetry row', () => {
    const original = fakeTurnExecutionResult({ telemetry: null });
    const revived = deserializeTurnResult(serializeTurnResult(original));
    expect(revived.telemetry).toBeNull();
  });
});

describe('writeFixtureArtifacts / readTurnResultArtifact', () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'eval-artifacts-'));
  });

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true });
  });

  it('writes warden-request.json and warden-output.json at the paths.ts layout', () => {
    const turnResult = buildResult();
    writeFixtureArtifacts(runDir, 1, 'turn19-out-of-order-resolution', {
      wardenRequests: [],
      turnResult,
    });

    expect(existsSync(wardenRequestPath(runDir, 1, 'turn19-out-of-order-resolution'))).toBe(
      true,
    );
    expect(existsSync(wardenOutputPath(runDir, 1, 'turn19-out-of-order-resolution'))).toBe(
      true,
    );
    expect(
      existsSync(fixtureArtifactDir(runDir, 1, 'turn19-out-of-order-resolution')),
    ).toBe(true);
  });

  it('writes warden-request.json as the captured request/response array', () => {
    const wardenRequests = [
      {
        request: {
          systemBlocks: [],
          messages: [],
          tools: [],
          toolChoice: { type: 'auto' as const },
          model: 'claude-sonnet-4-6',
          temperature: 1.0,
        },
        response: { id: 'msg_1', content: [] } as never,
      },
    ];
    writeFixtureArtifacts(runDir, 1, 'fixture-a', {
      wardenRequests,
      turnResult: buildResult(),
    });

    const raw = readFileSync(wardenRequestPath(runDir, 1, 'fixture-a'), 'utf-8');
    expect(JSON.parse(raw)).toHaveLength(1);
    expect(JSON.parse(raw)[0].request.model).toBe('claude-sonnet-4-6');
  });

  it('readTurnResultArtifact is the inverse of writeFixtureArtifacts', () => {
    const original = buildResult();
    writeFixtureArtifacts(runDir, 2, 'fixture-b', {
      wardenRequests: [],
      turnResult: original,
    });

    const read = readTurnResultArtifact(runDir, 2, 'fixture-b');

    expect(checkSystemRolledPlayerAction(read, APPLICABLE_FIXTURE)).toEqual(
      checkSystemRolledPlayerAction(original, APPLICABLE_FIXTURE),
    );
  });
});

describe('writeJudgeArtifact', () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), 'eval-judge-artifact-'));
  });

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true });
  });

  it('writes judge-<checkId>.json at the paths.ts layout', () => {
    writeJudgeArtifact(runDir, 1, 'turn24-hidden-info-leak', 'hidden-info-leak', {
      verdict: 'fail',
      rationale: 'leaked a roll value',
      rubricHash: 'deadbeef',
    });

    const path = judgeArtifactPath(
      runDir,
      1,
      'turn24-hidden-info-leak',
      'hidden-info-leak',
    );
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
      verdict: 'fail',
      rationale: 'leaked a roll value',
      rubricHash: 'deadbeef',
    });
  });
});

describe('relativeArtifactPath', () => {
  it('never returns an absolute path', () => {
    const runDir = '/evalroot/eval-runs/some-run';
    const target = wardenOutputPath(runDir, 1, 'turn19-out-of-order-resolution');

    const relativePath = relativeArtifactPath(runDir, target);

    expect(isAbsolute(relativePath)).toBe(false);
    expect(relativePath).toBe(
      join('reps', '001', 'turn19-out-of-order-resolution', 'warden-output.json'),
    );
  });
});
