import type { AdventureTelemetryPayload } from '../src/session/session.telemetry';

/**
 * Per-pool rejection counts across a run (M7.6 §6.2, measurement 1).
 *
 * **Why this is a measurement rather than a check.** Ten rejecting pools
 * instead of two widens the correction-loop surface, and the loop is bounded
 * at one re-prompt (`session.service.ts` — "single-shot, no inner loop"), so a
 * persistent Warden error *fails the turn* rather than degrading gracefully.
 * That converts "the Warden will apply the floor" from an assumption into a
 * number. It is not pass/fail per fixture, so it is not a registered check —
 * it is read off telemetry and reported alongside the tag rates.
 *
 * Watch the both-deltas rule hardest: it asks for conditional arithmetic,
 * which is a harder ask than the floor case.
 */
export interface RejectionCounts {
  /** Keyed `{owner}.{pool}`, or the raw path when it does not parse. */
  byPool: Record<string, number>;
  /** Keyed by the rule that fired, from the rejection's own reason text. */
  byRule: Record<string, number>;
  /**
   * Rejections of a `characterState` entry that sent a delta where an
   * absolute value belongs — bleeding and minimum stress.
   *
   * **In scope even though `characterState` telemetry is otherwise not**
   * (D3). Prompt instruction 3 is the one place the contract is inconsistent
   * with itself: every other numeric write in this milestone is a delta and
   * these two are not. One number, testing exactly that seam.
   */
  absoluteVsDelta: number;
  /** Turns that produced at least one rejection, over turns inspected. */
  turnsWithRejections: number;
  turnsInspected: number;
}

/**
 * Classifies a rejection by the rule that produced it, from the validator's
 * own reason text.
 *
 * Matching on the message rather than on a code is a real weakness and is
 * recorded as one: the validator does not emit a rule id, and adding one is a
 * change to a signature this milestone has already reworked once. The strings
 * matched here are stable literals in `session.validator.ts`, not model
 * output, so this is not prose classification — but a reworded message
 * silently moves a count into `other`, which is why `other` is reported rather
 * than folded away.
 */
function ruleFor(reason: string): string {
  if (/spend more than available|below minimum/i.test(reason)) return 'floor';
  if (/no ceiling/i.test(reason)) return 'max-delta-on-uncapped';
  if (/exceed its ceiling/i.test(reason)) return 'both-deltas';
  if (/exceed maximum/i.test(reason)) return 'system-max';
  if (/bootstrap/i.test(reason)) return 'bootstrap';
  if (/reserved leading-underscore/i.test(reason)) return 'reserved-owner';
  if (/does not resolve to a known entity/i.test(reason))
    return 'impersonation';
  if (/threshold, not a pool/i.test(reason)) return 'armor-threshold';
  if (/requires a parameter|takes no parameter|not a skill/i.test(reason)) {
    return 'condition-parameter';
  }
  return 'other';
}

/** `resourcePools[1] (dr_chen.hp)` → `dr_chen.hp`. */
function poolFor(path: string): string {
  const match = path.match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : path;
}

/**
 * True when a rejection is the absolute-vs-delta seam firing — a
 * `characterState` entry whose value was sent as an increment.
 *
 * The schema rejects a negative `bleeding_set` at parse time rather than in
 * the validator, so the visible signature is a `value` that is small relative
 * to what it replaced. That is not decidable from the rejection alone, so this
 * counts the case the validator *can* see: a `minimum_stress_set` below 2,
 * which is what sending an increment of 1 or 2 produces.
 */
function isAbsoluteVsDelta(path: string, reason: string): boolean {
  return (
    /minimum_stress_set|bleeding_set/.test(path) &&
    /at least 2|greater than or equal to 2|Number must be/i.test(reason)
  );
}

export function countRejections(
  payloads: ReadonlyArray<AdventureTelemetryPayload>,
): RejectionCounts {
  const counts: RejectionCounts = {
    byPool: {},
    byRule: {},
    absoluteVsDelta: 0,
    turnsWithRejections: 0,
    turnsInspected: payloads.length,
  };

  for (const payload of payloads) {
    const rejections = payload.correction?.rejections ?? [];
    if (rejections.length === 0) continue;
    counts.turnsWithRejections += 1;

    for (const rejection of rejections) {
      if (rejection.path.startsWith('resourcePools')) {
        const pool = poolFor(rejection.path);
        counts.byPool[pool] = (counts.byPool[pool] ?? 0) + 1;
      }
      const rule = ruleFor(rejection.reason);
      counts.byRule[rule] = (counts.byRule[rule] ?? 0) + 1;
      if (isAbsoluteVsDelta(rejection.path, rejection.reason)) {
        counts.absoluteVsDelta += 1;
      }
    }
  }

  return counts;
}

/** Markdown lines for the run report; empty when nothing was rejected. */
export function renderRejectionCounts(counts: RejectionCounts): string[] {
  if (counts.turnsWithRejections === 0) {
    return [
      `No state changes were rejected across ${counts.turnsInspected} turn(s).`,
    ];
  }

  const lines = [
    `Rejections in ${counts.turnsWithRejections} of ${counts.turnsInspected} turn(s).`,
    '',
    '| Pool | Rejections |',
    '|---|---|',
    ...Object.entries(counts.byPool)
      .sort((a, b) => b[1] - a[1])
      .map(([pool, n]) => `| \`${pool}\` | ${n} |`),
    '',
    '| Rule | Rejections |',
    '|---|---|',
    ...Object.entries(counts.byRule)
      .sort((a, b) => b[1] - a[1])
      .map(([rule, n]) => `| ${rule} | ${n} |`),
  ];

  if (counts.absoluteVsDelta > 0) {
    lines.push(
      '',
      `**Absolute-vs-delta confusions: ${counts.absoluteVsDelta}.** Bleeding ` +
        'and Minimum Stress are the only numeric writes in this milestone ' +
        'sent as absolute values; every other one is a delta. This counts the ' +
        'one place the contract is inconsistent with itself.',
    );
  }

  return lines;
}
