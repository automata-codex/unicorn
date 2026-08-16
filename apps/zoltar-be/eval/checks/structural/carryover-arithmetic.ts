import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

/**
 * The pool-change entries a turn proposed, in order, as `submit_gm_response`
 * carried them. Typed loosely on purpose — this reads a frozen artifact, and
 * `eval:rescore` grades runs captured before the array shape existed.
 */
interface PoolChange {
  owner?: unknown;
  pool?: unknown;
  delta?: unknown;
  maxDelta?: unknown;
  reason?: unknown;
  damageType?: unknown;
}

interface GmResponsePayload {
  stateChanges?: { resourcePools?: unknown };
}

/**
 * Reads the winning turn's proposed pool changes.
 *
 * **Branches on field presence, not on a schema version** (§6.1, the
 * `rollType` precedent). A pre-M7.6 artifact carries `resourcePools` as a map
 * keyed by pool name, which is not an array and has no `owner` — that is
 * `NOT_APPLICABLE`, permanently and correctly, because the turn could not have
 * expressed a carryover chain in the first place. This is a compatibility
 * branch rather than a dead corpus: `eval:rescore` must keep grading frozen
 * artifacts after the shape changed.
 */
function readPoolChanges(result: TurnExecutionResult): PoolChange[] | null {
  const event = result.gameEvents
    .filter(
      (e) => e.eventType === 'gm_response' || e.eventType === 'correction',
    )
    .sort((a, b) => b.sequenceNumber - a.sequenceNumber)[0];
  if (!event) return null;

  const payload = event.payload as GmResponsePayload | null;
  const changes = payload?.stateChanges?.resourcePools;
  if (!Array.isArray(changes)) return null;
  return changes as PoolChange[];
}

const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Damage dealt to `owner` this turn, summed across the turn's damage rolls.
 *
 * **This is the input the deltas cannot supply.** `hp` has `min: 0` since
 * Part 1, so the validator rejects a delta that would go below zero — which
 * means a hit for 14 against 10 Health arrives as `delta: -10` and the
 * carryover of 4 is nowhere in the pool change at all. It is in the roll.
 *
 * Sums rather than takes the largest: two hits in one turn both count toward
 * the Health that ran out. Rolls with no `rollType` are pre-M7.5 artifacts and
 * are not counted, which is what makes this check report `NOT_APPLICABLE`
 * against a frozen run rather than guessing.
 */
function damageDealtTo(
  result: TurnExecutionResult,
  owner: string,
): number | null {
  const rolls = result.gameEvents.filter((e) => e.eventType === 'dice_roll');
  let total = 0;
  let found = false;
  for (const roll of rolls) {
    const payload = roll.payload as {
      rollType?: unknown;
      actingEntityId?: unknown;
      total?: unknown;
    } | null;
    if (payload?.rollType !== 'damage') continue;
    if (payload.actingEntityId !== owner) continue;
    if (!isNumber(payload.total)) continue;
    total += payload.total;
    found = true;
  }
  return found ? total : null;
}

/**
 * CARRYOVER-ARITHMETIC — did a wounds chain reset Health to the right number?
 *
 * The chain is: damage drives `hp.current` to zero or below, `wounds` goes up,
 * and Health resets to its **Maximum minus carryover**, where carryover is the
 * damage that exceeded the Health the character had left (PSG §28.2).
 *
 * Carryover is Warden-computed (§3.3) — it is not a delta readable off a
 * table, and keeping it Warden-side is what keeps it out of the Phase 3
 * arithmetic layer. The cost is a new failure mode, and this is the check that
 * makes it visible.
 *
 * **Event and state structure only, no prose.** Everything needed is in the
 * proposed changes and the pre-turn pool values, per
 * `decisions.md § A structural check may read event and state structure; it
 * may not classify prose`. The narration is never consulted.
 */
export function checkCarryoverArithmetic(
  result: TurnExecutionResult,
  _fixture: EvalFixture,
): StructuralVerdict {
  const changes = readPoolChanges(result);
  if (changes === null) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'Turn proposed no resourcePools array — a pre-M7.6 artifact, or a ' +
        'turn that changed no pools.',
      actualCode: 'no-pool-array',
    };
  }

  // Group by owner: a chain is per character, and a turn can wound two.
  const owners = new Set(
    changes
      .filter((c) => c.pool === 'hp' && typeof c.owner === 'string')
      .map((c) => c.owner as string),
  );

  const chains: Array<{ owner: string; verdict: string; ok: boolean }> = [];

  for (const owner of owners) {
    const hpChanges = changes.filter(
      (c) => c.owner === owner && c.pool === 'hp' && isNumber(c.delta),
    );
    // A chain needs at least two hp entries: the damage and the reset. One
    // entry is ordinary damage or healing, which has no carryover to check.
    if (hpChanges.length < 2) continue;

    const wounded = changes.some(
      (c) =>
        c.owner === owner &&
        c.pool === 'wounds' &&
        isNumber(c.delta) &&
        (c.delta as number) > 0,
    );
    if (!wounded) continue;

    const priorPools = (
      result.campaignState as {
        resourcePools?: Record<
          string,
          Record<string, { current?: unknown; max?: unknown }>
        >;
      }
    ).resourcePools?.[owner];
    const hpMax = priorPools?.hp?.max;
    const endCurrent = priorPools?.hp?.current;
    if (!isNumber(endCurrent)) continue;
    if (!isNumber(hpMax)) {
      chains.push({
        owner,
        ok: false,
        verdict: `${owner}: hp has no ceiling in state, so the reset target is undefined`,
      });
      continue;
    }

    // `campaignState` is the POST-turn state, so unwind the deltas to recover
    // where Health started. That the sum of the deltas explains the change is
    // exactly the property the in-order fold guarantees.
    const totalDelta = hpChanges.reduce(
      (sum, c) => sum + (c.delta as number),
      0,
    );
    const startCurrent = endCurrent - totalDelta;

    const damageDealt = damageDealtTo(result, owner);
    if (damageDealt === null) {
      chains.push({
        owner,
        ok: false,
        verdict:
          `${owner}: a wounds chain ran but no damage roll is attributed to ` +
          'them, so the carryover has no input to check against',
      });
      continue;
    }

    const carryover = Math.max(0, damageDealt - startCurrent);
    const expectedEnd = hpMax - carryover;

    chains.push({
      owner,
      ok: endCurrent === expectedEnd,
      verdict:
        endCurrent === expectedEnd
          ? `${owner}: ${startCurrent} Health, ${damageDealt} damage, ` +
            `carryover ${carryover}, reset to ${endCurrent} of ${hpMax}`
          : `${owner}: ${startCurrent} Health took ${damageDealt} damage, so ` +
            `carryover is ${carryover} and Health should reset to ` +
            `${expectedEnd} of ${hpMax} — the turn left it at ${endCurrent}`,
    });
  }

  if (chains.length === 0) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'No wounds chain this turn — no pool took a second hp entry alongside a wounds increase.',
      actualCode: 'no-chain',
    };
  }

  const failed = chains.filter((c) => !c.ok);
  if (failed.length > 0) {
    return {
      outcome: 'FAILED',
      actual: failed.map((c) => c.verdict).join('; '),
    };
  }

  return {
    outcome: 'PASSED',
    actual: chains.map((c) => c.verdict).join('; '),
  };
}
