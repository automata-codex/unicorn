import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  seededCanonContradictionGate,
  seededCanonContradictionJudgeContext,
  seededCanonFor,
} from './seeded-canon-contradiction';
import {
  fakeFixture,
  fakeGameEvent,
  fakeTurnExecutionResult,
} from './test-helpers';

import type { EvalFixture } from '../../fixture.schema';

const SHIP_LAYOUT =
  'Upper deck: bridge, engineering records terminal (aft of bridge). ' +
  'Mid deck: crew berths, mess hall, cryo bay. ' +
  'Lower deck: cargo bay, engine room.';

function narratedTurn() {
  return fakeTurnExecutionResult({
    gameEvents: [
      fakeGameEvent({
        sequenceNumber: 23,
        eventType: 'gm_response',
        payload: { playerText: 'You climb down toward the deck below.' },
      }),
    ],
  });
}

function seeded(overrides: {
  worldFacts?: Record<string, unknown>;
  openingNarration?: string | null;
}): EvalFixture {
  const base = fakeFixture();
  return fakeFixture({
    seededState: {
      ...base.seededState,
      campaignState: {
        entities: {},
        worldFacts: overrides.worldFacts ?? { ship_layout: SHIP_LAYOUT },
      },
      gmContextBlob: {
        ...base.seededState.gmContextBlob,
        ...(overrides.openingNarration === undefined
          ? {}
          : { openingNarration: overrides.openingNarration }),
      },
    },
  });
}

describe('seededCanonFor', () => {
  it('keeps only non-empty string worldFacts values', () => {
    // `worldFacts` is `Record<string, unknown>` in a captured fixture, since
    // seededState is validated loosely on purpose. A non-string value cannot
    // be rendered as ground truth and must not reach the judge as "[object
    // Object]".
    const canon = seededCanonFor(
      seeded({
        worldFacts: {
          ship_layout: SHIP_LAYOUT,
          empty: '',
          structured: { deck: 'upper' },
          numeric: 412,
        },
      }),
    );

    expect(Object.keys(canon.worldFacts)).toEqual(['ship_layout']);
  });

  it('reads the opening narration from the gm context blob', () => {
    const canon = seededCanonFor(
      seeded({ openingNarration: 'The fixtures went dark two nights ago.' }),
    );
    expect(canon.openingNarration).toBe(
      'The fixtures went dark two nights ago.',
    );
  });
});

describe('seededCanonContradictionGate', () => {
  it('excludes a turn the Warden never narrated', () => {
    const verdict = seededCanonContradictionGate(
      fakeTurnExecutionResult({ gameEvents: [] }),
      seeded({}),
    );

    expect(verdict?.outcome).toBe('NOT_APPLICABLE');
    expect(verdict?.actualCode).toBe('no gm_response event this turn');
  });

  it('excludes a fixture seeding nothing that could be contradicted', () => {
    // Distinct from the branch above, and the distinction is the point: this
    // one is a property of the fixture and will repeat on every rep, so it
    // reads as a fixture-authoring problem rather than as Warden behaviour.
    const verdict = seededCanonContradictionGate(
      narratedTurn(),
      seeded({ worldFacts: {}, openingNarration: null }),
    );

    expect(verdict?.outcome).toBe('NOT_APPLICABLE');
    expect(verdict?.actualCode).toBe(
      'fixture seeds no worldFacts and no opening narration',
    );
    expect(verdict?.actual).toContain('every rep');
  });

  it('falls through on an opening narration alone, with no worldFacts', () => {
    // `ADR-0104`'s timeline subtype (turn 1) contradicts the seeded opening
    // narration, not worldFacts. A gate reading only worldFacts would exclude
    // exactly the case that motivated scoping the tag wider than layout.
    const verdict = seededCanonContradictionGate(
      narratedTurn(),
      seeded({
        worldFacts: {},
        openingNarration: 'The fixtures went dark two nights ago.',
      }),
    );

    expect(verdict).toBeNull();
  });

  it('falls through when the turn narrated and the fixture seeds canon', () => {
    expect(seededCanonContradictionGate(narratedTurn(), seeded({}))).toBeNull();
  });
});

describe('seededCanonContradictionJudgeContext', () => {
  it('renders seeded values verbatim rather than summarised', () => {
    // `ADR-0105`'s corollary: data selected from seededState falls under
    // corpusVersion, data the renderer authors falls under nothing. A
    // paraphrase would also be free to drift from what the Warden was shown,
    // which is the only thing this check compares against.
    const context = seededCanonContradictionJudgeContext(
      narratedTurn(),
      seeded({}),
    );

    expect(context).toContain(SHIP_LAYOUT);
  });

  it('tells the judge not to import outside assumptions about ship layout', () => {
    // Without this the model grades against how ships usually work, and the
    // whole point is that the Warden had one specific layout in front of it.
    const context = seededCanonContradictionJudgeContext(
      narratedTurn(),
      seeded({}),
    );

    expect(context).toContain('do not import assumptions');
  });

  it('omits the sections a fixture has nothing for', () => {
    const worldFactsOnly = seededCanonContradictionJudgeContext(
      narratedTurn(),
      seeded({ openingNarration: null }),
    );
    expect(worldFactsOnly).toContain('--- world facts ---');
    expect(worldFactsOnly).not.toContain('--- opening narration ---');

    const narrationOnly = seededCanonContradictionJudgeContext(
      narratedTurn(),
      seeded({
        worldFacts: {},
        openingNarration: 'Three weeks out from the relay.',
      }),
    );
    expect(narrationOnly).not.toContain('--- world facts ---');
    expect(narrationOnly).toContain('--- opening narration ---');
  });

  it('orders worldFacts keys so two captures of one adventure agree', () => {
    const context = seededCanonContradictionJudgeContext(
      narratedTurn(),
      seeded({
        worldFacts: { zulu: 'last', alpha: 'first', mike: 'middle' },
      }),
    );

    expect(context.indexOf('alpha:')).toBeLessThan(context.indexOf('mike:'));
    expect(context.indexOf('mike:')).toBeLessThan(context.indexOf('zulu:'));
  });
});

/**
 * `ADR-0104` names this golden as part of the work rather than optional, and
 * `ADR-0105` says why: `judgeContext` output reaches the judge covered by no
 * hash, so editing this renderer changes what the grader reads while moving
 * `rubricHash`, `judgeContractHash` and `corpusVersion` not at all.
 */
describe('seededCanonContradictionJudgeContext golden (`ADR-0105`)', () => {
  const GOLDEN = join(
    __dirname,
    '..',
    'judged',
    'judge-context-golden',
    'seeded-canon-contradiction.txt',
  );

  it('renders the frozen probe exactly as committed', () => {
    const rendered = seededCanonContradictionJudgeContext(
      narratedTurn(),
      seeded({
        // Two facts and an opening narration, so the golden covers every
        // section and the blank-line join between multiple facts.
        worldFacts: {
          ship_layout: SHIP_LAYOUT,
          colonist_count: '412 colonists in cryo suspension across mid-deck.',
        },
        openingNarration:
          'The mid-deck fixtures went dark two nights ago and nobody has fixed them.',
      }),
    );

    expect(existsSync(GOLDEN)).toBe(true);
    expect(rendered).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});
