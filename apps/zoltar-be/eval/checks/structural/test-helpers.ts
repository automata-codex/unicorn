import { FIXTURE_SCHEMA_VERSION } from '../../fixture.schema';

import type * as schema from '../../../src/db/schema';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';

type GameEventRow = typeof schema.gameEvents.$inferSelect;
type PendingCanonRow = typeof schema.pendingCanon.$inferSelect;
type DiceRequestRow = typeof schema.diceRequests.$inferSelect;

const CAMPAIGN_ID = '00000000-0000-0000-0000-0000000000c1';
const ADVENTURE_ID = '00000000-0000-0000-0000-0000000000a1';

let nextId = 0;
function fakeId(): string {
  nextId += 1;
  return `fake-id-${nextId}`;
}

export function fakeGameEvent(
  overrides: Partial<GameEventRow> &
    Pick<GameEventRow, 'sequenceNumber' | 'eventType'>,
): GameEventRow {
  return {
    id: fakeId(),
    campaignId: CAMPAIGN_ID,
    adventureId: ADVENTURE_ID,
    actorType: 'gm',
    actorId: null,
    rollSource: null,
    payload: {},
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    supersededBy: null,
    ...overrides,
  };
}

/**
 * `rollId` / `rollType` / `actingEntityId` / `gatedByRollId` are omitted
 * unless a test asks for them, which makes the **pre-M7.5 payload the
 * default** in every existing test.
 *
 * That is deliberate rather than incidental. The checkers branch on field
 * presence so `eval:rescore` keeps producing identical verdicts against the
 * frozen `88fa84bd8329` artifacts, and the only way to keep testing that
 * promise is for most of this file's fixtures to look like those artifacts
 * do — fieldless.
 */
export function fakeDiceRoll(overrides: {
  sequenceNumber: number;
  purpose: string;
  rollSource?: 'system_generated' | 'player_entered' | null;
  requestId?: string;
  notation?: string;
  results?: number[];
  total?: number;
  rollId?: string;
  rollType?: string;
  actingEntityId?: string;
  gatedByRollId?: string;
}): GameEventRow {
  return fakeGameEvent({
    sequenceNumber: overrides.sequenceNumber,
    eventType: 'dice_roll',
    actorType: overrides.rollSource === 'player_entered' ? 'player' : 'gm',
    rollSource: overrides.rollSource ?? 'system_generated',
    payload: {
      notation: overrides.notation ?? '1d10',
      purpose: overrides.purpose,
      results: overrides.results ?? [5],
      modifier: 0,
      total: overrides.total ?? 5,
      ...(overrides.requestId ? { requestId: overrides.requestId } : {}),
      ...(overrides.rollId ? { rollId: overrides.rollId } : {}),
      ...(overrides.rollType ? { rollType: overrides.rollType } : {}),
      ...(overrides.actingEntityId
        ? { actingEntityId: overrides.actingEntityId }
        : {}),
      ...(overrides.gatedByRollId
        ? { gatedByRollId: overrides.gatedByRollId }
        : {}),
    },
  });
}

export function fakePendingCanon(
  overrides: Partial<PendingCanonRow> &
    Pick<PendingCanonRow, 'summary' | 'context'>,
): PendingCanonRow {
  return {
    id: fakeId(),
    adventureId: ADVENTURE_ID,
    status: 'pending',
    sequenceNumber: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    reviewedAt: null,
    ...overrides,
  };
}

export function fakeDiceRequest(
  overrides: Partial<DiceRequestRow> &
    Pick<DiceRequestRow, 'notation' | 'purpose'>,
): DiceRequestRow {
  return {
    id: fakeId(),
    adventureId: ADVENTURE_ID,
    issuedAtSequence: 1,
    target: null,
    status: 'pending',
    resolvedAtSequence: null,
    resolvedAt: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

const FAKE_SERVICE_RESULT: TurnExecutionResult['serviceResult'] = {
  kind: 'message',
  result: {
    message: {
      id: fakeId(),
      adventureId: ADVENTURE_ID,
      role: 'gm',
      content: '',
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
    } as never,
    applied: {} as never,
    thresholds: [],
    diceRequests: [],
  },
};

export function fakeTurnExecutionResult(
  overrides: Partial<TurnExecutionResult> = {},
): TurnExecutionResult {
  return {
    gameEvents: [],
    telemetry: null,
    pendingCanon: [],
    campaignState: {},
    diceRequests: [],
    serviceResult: FAKE_SERVICE_RESULT,
    ...overrides,
  };
}

/**
 * Entity ids the default `fakeFixture` declares.
 *
 * **Not cosmetic.** `rollActsFor` resolves `actingEntityId` against these
 * sets, and an id in neither is `'unknown'` — undecided, never a pass. The
 * defaults therefore have to cover the ids the specs actually emit, or every
 * test asserting a PASSED on a field-carrying payload silently converts into
 * a test asserting NOT_APPLICABLE and stops checking what it was written to
 * check.
 *
 * `alvarez` and `lt_alvarez` both appear because the captured adventure
 * carries both prefixes for one character — see
 * `docs/rules-extraction-findings.md § S30`. The specs inherit that so they
 * exercise the same ambiguity the real fixtures have.
 */
const DEFAULT_PLAYER_ENTITY_IDS = ['lt_alvarez', 'alvarez'];
const DEFAULT_SEEDED_ENTITIES = {
  corporate_spy_1: { status: 'alive', visible: true },
};

export function fakeFixture(overrides: Partial<EvalFixture> = {}): EvalFixture {
  return {
    id: 'test-fixture',
    tag: 'OUT-OF-ORDER-RESOLUTION',
    sourceAdventureId: '00000000-0000-0000-0000-000000000099',
    sourceSequenceNumber: 1,
    fixtureSchemaVersion: FIXTURE_SCHEMA_VERSION,
    seededState: {
      campaignState: { entities: { ...DEFAULT_SEEDED_ENTITIES } },
      gmContextBlob: { playerEntityIds: [...DEFAULT_PLAYER_ENTITY_IDS] },
      pendingCanon: [],
      messages: [],
      pendingDiceRequests: [],
      capturedAt: '2026-07-15T00:00:00.000Z',
    },
    playerInput: { type: 'message', content: 'test' },
    assertion: { mode: 'structural', check: 'test' },
    ...overrides,
  };
}
