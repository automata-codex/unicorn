import { describe, expect, it } from 'vitest';

import { checkMissingCanonCapture } from './missing-canon-capture';
import {
  fakeFixture,
  fakeGameEvent,
  fakePendingCanon,
  fakeTurnExecutionResult,
} from './test-helpers';

const FIXTURE = fakeFixture({
  tag: 'MISSING-CANON-CAPTURE',
  seededState: {
    campaignState: { worldFacts: { corridor_length: 'eight meters' } },
    gmContextBlob: {},
    pendingCanon: [],
    messages: [],
    pendingDiceRequests: [],
    capturedAt: '2026-07-15T00:00:00.000Z',
  },
  assertion: {
    mode: 'structural',
    check: 'expects: a new worldFacts entry describing the brig location',
  },
});

describe('checkMissingCanonCapture', () => {
  it('passes when campaignState.worldFacts gained a new key this turn', () => {
    const result = fakeTurnExecutionResult({
      campaignState: {
        worldFacts: {
          corridor_length: 'eight meters',
          brig_location: 'deck 2',
        },
      },
    });

    const verdict = checkMissingCanonCapture(result, FIXTURE);
    expect(verdict.outcome).toBe('PASSED');
    expect(verdict.actual).toMatch(/brig_location/);
  });

  it('passes when a new pending_canon row was proposed this turn', () => {
    const result = fakeTurnExecutionResult({
      campaignState: { worldFacts: { corridor_length: 'eight meters' } },
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 3, eventType: 'gm_response' }),
      ],
      pendingCanon: [
        fakePendingCanon({
          summary: 'Brig is on deck 2',
          context: 'Cell door found.',
          sequenceNumber: 3,
        }),
      ],
    });

    const verdict = checkMissingCanonCapture(result, FIXTURE);
    expect(verdict.outcome).toBe('PASSED');
    expect(verdict.actual).toMatch(/Brig is on deck 2/);
  });

  it('fails when neither worldFacts nor pending_canon changed (deliberately-broken counterexample)', () => {
    const result = fakeTurnExecutionResult({
      campaignState: { worldFacts: { corridor_length: 'eight meters' } },
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 3, eventType: 'gm_response' }),
      ],
      pendingCanon: [],
    });

    const verdict = checkMissingCanonCapture(result, FIXTURE);
    expect(verdict.outcome).toBe('FAILED');
    expect(verdict.actual).toMatch(/unchanged/);
  });

  it('does not count a pending_canon row proposed by an earlier turn (boundary)', () => {
    const result = fakeTurnExecutionResult({
      campaignState: { worldFacts: { corridor_length: 'eight meters' } },
      gameEvents: [
        fakeGameEvent({ sequenceNumber: 5, eventType: 'gm_response' }),
      ],
      pendingCanon: [
        fakePendingCanon({
          summary: 'Ship has a brig',
          context: 'From an earlier turn.',
          sequenceNumber: 2,
        }),
      ],
    });

    expect(checkMissingCanonCapture(result, FIXTURE).outcome).toBe('FAILED');
  });

  it('throws when the fixture check text has no "expects:" marker', () => {
    const badFixture = fakeFixture({
      tag: 'MISSING-CANON-CAPTURE',
      assertion: { mode: 'structural', check: 'no marker here' },
    });

    expect(() =>
      checkMissingCanonCapture(fakeTurnExecutionResult(), badFixture),
    ).toThrow(/expects:/);
  });
});
