import { describe, expect, it } from 'vitest';

import {
  mergeTimeline,
  type DiceRollWire,
  type MessageWire,
} from './timeline';

const msg = (id: string, t: string, role: MessageWire['role'] = 'user'): MessageWire => ({
  id,
  role,
  content: id,
  createdAt: t,
});

const dice = (id: string, t: string, seq = 0): DiceRollWire => ({
  id,
  sequenceNumber: seq,
  createdAt: t,
  source: 'system_generated',
  notation: '1d100',
  purpose: 'x',
  results: [42],
  total: 42,
  target: null,
});

describe('mergeTimeline', () => {
  it('returns an empty timeline when both streams are empty', () => {
    expect(mergeTimeline([], [])).toEqual([]);
  });

  it('returns messages-only when no dice rolls exist', () => {
    const m1 = msg('m1', '2026-04-01T12:00:00.000Z');
    const m2 = msg('m2', '2026-04-01T12:00:01.000Z');
    const result = mergeTimeline([m1, m2], []);
    expect(result.map((e) => e.id)).toEqual(['m1', 'm2']);
    expect(result.every((e) => e.type === 'message')).toBe(true);
  });

  it('returns dice-only when no messages exist', () => {
    const d1 = dice('d1', '2026-04-01T12:00:00.000Z');
    const result = mergeTimeline([], [d1]);
    expect(result[0].type).toBe('dice_roll');
  });

  it('interleaves messages and dice rolls by createdAt', () => {
    const p = msg('player', '2026-04-01T12:00:00.000Z');
    const d1 = dice('roll-1', '2026-04-01T12:00:01.000Z');
    const d2 = dice('roll-2', '2026-04-01T12:00:02.000Z');
    const gm = msg('gm', '2026-04-01T12:00:03.000Z', 'assistant');

    const result = mergeTimeline([p, gm], [d1, d2]);

    expect(result.map((e) => e.id)).toEqual([
      'player',
      'roll-1',
      'roll-2',
      'gm',
    ]);
  });

  it('preserves discriminator on each entry', () => {
    const p = msg('p', '2026-04-01T12:00:00.000Z');
    const d = dice('d', '2026-04-01T12:00:01.000Z');
    const result = mergeTimeline([p], [d]);
    expect(result.filter((e) => e.type === 'message')).toHaveLength(1);
    expect(result.filter((e) => e.type === 'dice_roll')).toHaveLength(1);
  });

  it('preserves insertion order on ties (messages before same-ms dice rolls)', () => {
    const p = msg('p', '2026-04-01T12:00:00.000Z');
    const d = dice('d', '2026-04-01T12:00:00.000Z');
    const result = mergeTimeline([p], [d]);
    // Messages are emitted first during tagging, so on an exact tie they
    // come first by stable sort.
    expect(result[0].id).toBe('p');
    expect(result[1].id).toBe('d');
  });
});
