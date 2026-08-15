import { describe, expect, it } from 'vitest';

import { countRejections, renderRejectionCounts } from './rejection-counts';

import type { AdventureTelemetryPayload } from '../src/session/session.telemetry';
import type { ValidationRejection } from '../src/session/session.validator';

function turn(
  rejections: ValidationRejection[] = [],
): AdventureTelemetryPayload {
  const payload = {
    playerMessage: 'x',
    snapshotSent: '',
    originalRequest: {
      model: 'm',
      systemBlocks: 1,
      messageCount: 1,
      promptTokens: null,
      completionTokens: null,
    },
    originalResponse: { playerText: 'x' },
    notes: { original: null, correction: null },
    applied: {
      resourcePools: {},
      characterState: {},
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    },
    thresholds: [],
    diceRolls: [],
    rulesLookups: [],
    toolLoopIterations: 1,
    wardenPrompt: { filename: 'p.txt', hash: 'h' },
  } as unknown as AdventureTelemetryPayload;

  if (rejections.length > 0) {
    (payload as { correction?: unknown }).correction = {
      rejections,
      correctionRequest: { promptTokens: null, completionTokens: null },
      correctionResponse: { playerText: 'x' },
    };
  }
  return payload;
}

const reject = (path: string, reason: string): ValidationRejection => ({
  path,
  reason,
  received: {},
});

describe('countRejections', () => {
  it('counts nothing for a clean run', () => {
    const counts = countRejections([turn(), turn()]);
    expect(counts.turnsWithRejections).toBe(0);
    expect(counts.turnsInspected).toBe(2);
    expect(counts.byPool).toEqual({});
  });

  it('counts per pool, addressed owner-first', () => {
    const counts = countRejections([
      turn([
        reject(
          'resourcePools[0] (alvarez.stress)',
          'Cannot spend more than available: alvarez.stress is at 2',
        ),
      ]),
      turn([
        reject(
          'resourcePools[1] (alvarez.stress)',
          'Cannot spend more than available: alvarez.stress is at 0',
        ),
      ]),
      turn([
        reject(
          'resourcePools[0] (alvarez.hp)',
          'Cannot spend more than available: alvarez.hp is at 3',
        ),
      ]),
    ]);
    expect(counts.byPool).toEqual({ 'alvarez.stress': 2, 'alvarez.hp': 1 });
    expect(counts.turnsWithRejections).toBe(3);
  });

  it('groups by the rule that fired', () => {
    const counts = countRejections([
      turn([
        reject(
          'resourcePools[0] (alvarez.hp)',
          'Cannot spend more than available: x',
        ),
        reject(
          'resourcePools[1] (alvarez.stress)',
          'Pool "alvarez.stress" has no ceiling, so maxDelta has nothing to change.',
        ),
      ]),
      turn([
        reject(
          'resourcePools[0] (alvarez.hp)',
          'Pool value 18 would exceed its ceiling 16.',
        ),
      ]),
    ]);
    expect(counts.byRule).toEqual({
      floor: 1,
      'max-delta-on-uncapped': 1,
      'both-deltas': 1,
    });
  });

  it('files an unrecognised reason under `other` rather than dropping it', () => {
    // A reworded validator message silently moves a count here, which is why
    // `other` is reported rather than folded away.
    const counts = countRejections([
      turn([reject('resourcePools[0] (a.b)', 'something new and unmatched')]),
    ]);
    expect(counts.byRule.other).toBe(1);
  });

  it('counts the absolute-vs-delta seam separately', () => {
    // Prompt instruction 3 is the one place the contract is inconsistent with
    // itself: bleeding and minimum stress are absolute, everything else is a
    // delta. Sending an increment of 1 shows up as a floor violation on
    // `minimum_stress_set`.
    const counts = countRejections([
      turn([
        reject(
          'characterState[0] (minimum_stress_set alvarez)',
          'Number must be greater than or equal to 2',
        ),
      ]),
    ]);
    expect(counts.absoluteVsDelta).toBe(1);
  });

  it('does not count pool rejections toward the absolute-vs-delta seam', () => {
    const counts = countRejections([
      turn([
        reject(
          'resourcePools[0] (alvarez.stress)',
          'Cannot spend more than available: x',
        ),
      ]),
    ]);
    expect(counts.absoluteVsDelta).toBe(0);
  });

  it('keeps characterState paths out of the per-pool table', () => {
    const counts = countRejections([
      turn([
        reject(
          'characterState[0] (armor_damage alvarez)',
          'Armor Points are a threshold, not a pool',
        ),
      ]),
    ]);
    expect(counts.byPool).toEqual({});
    expect(counts.byRule['armor-threshold']).toBe(1);
  });
});

describe('renderRejectionCounts', () => {
  it('says so plainly when nothing was rejected', () => {
    const lines = renderRejectionCounts(countRejections([turn(), turn()]));
    expect(lines.join('\n')).toContain('No state changes were rejected');
  });

  it('renders both tables and the seam note', () => {
    const lines = renderRejectionCounts(
      countRejections([
        turn([
          reject(
            'resourcePools[0] (alvarez.hp)',
            'Cannot spend more than available: x',
          ),
          reject(
            'characterState[1] (minimum_stress_set alvarez)',
            'Number must be greater than or equal to 2',
          ),
        ]),
      ]),
    );
    const text = lines.join('\n');
    expect(text).toContain('| `alvarez.hp` | 1 |');
    expect(text).toContain('| floor | 1 |');
    expect(text).toContain('Absolute-vs-delta confusions: 1');
  });
});
