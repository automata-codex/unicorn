import { isAttributedTo } from './attribution';
import { requireApplicability } from './types';

import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

const CHECK_ID = 'out-of-order-resolution';

function purposeOf(roll: TurnExecutionResult['gameEvents'][number]): string {
  return (roll.payload as DiceRollEventPayload).purpose ?? '';
}

type DiceRollEvent = TurnExecutionResult['gameEvents'][number];

/**
 * The in-turn case, decidable since M7.5 gave `dice_roll` a `gatedByRollId`.
 *
 * Reached when the turn left no pending `dice_request`, so there is no
 * deferred gate to order anything against. Before the field existed this
 * reported `NOT_APPLICABLE` naming what was missing, because sequence
 * numbers record what happened *first*, not what depended on what — and a
 * to-hit followed by damage is correct while damage followed by a to-hit is
 * not, the same two events in either order.
 *
 * With the field, the violation is a roll whose named gate resolved *after*
 * it: the consequence was rolled before the thing it was contingent on. Read
 * off two sequence numbers and a reference, with nothing inferred from
 * wording.
 *
 * **A dangling `gatedByRollId` cannot reach here.** `SessionService`'s tool
 * loop rejects a reference naming no roll from the same turn with an
 * `is_error` tool_result, so any link present in a persisted payload
 * resolved at the time it was written. It is still handled — as undecided,
 * never as a pass — because a frozen artifact from a future schema change,
 * or a hand-authored fixture, could carry one, and silently treating an
 * unresolvable link as "no violation" is the false-pass shape this checker
 * has already been rebuilt twice to avoid.
 */
function checkInTurnOrdering(diceRolls: DiceRollEvent[]): StructuralVerdict {
  const bySequence = new Map(
    diceRolls.map((roll) => [
      (roll.payload as DiceRollEventPayload).rollId,
      roll.sequenceNumber,
    ]),
  );

  const gated = diceRolls.filter(
    (roll) =>
      (roll.payload as DiceRollEventPayload).gatedByRollId !== undefined,
  );

  if (gated.length === 0) {
    // No roll claims to depend on another. That is the ordinary shape of a
    // turn whose rolls are independent, and there is no ordering question to
    // answer — not a gap in the data. Distinguished in `actualCode` from the
    // pre-M7.5 "the field doesn't exist" case so the two never aggregate
    // together in an exclusions table.
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'no dice_request is pending at the end of this turn, and none of the ' +
        `${diceRolls.length} roll(s) resolved in-turn names a gatedByRollId — so no ` +
        'roll claims to depend on another and there is no ordering to adjudicate',
      actualCode: 'no pending dice_request and no in-turn roll declares a gate',
    };
  }

  const unresolved = gated.filter(
    (roll) =>
      !bySequence.has((roll.payload as DiceRollEventPayload).gatedByRollId),
  );
  if (unresolved.length > 0) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual: unresolved
        .map(
          (roll) =>
            `sequence ${roll.sequenceNumber}: gatedByRollId ` +
            `"${(roll.payload as DiceRollEventPayload).gatedByRollId}" names no roll in ` +
            'this turn, so the dependency it asserts cannot be checked',
        )
        .join('; '),
      actualCode:
        'in-turn gatedByRollId does not resolve to a roll in this turn',
    };
  }

  const premature = gated.filter((roll) => {
    const gateSequence = bySequence.get(
      (roll.payload as DiceRollEventPayload).gatedByRollId,
    );
    return gateSequence !== undefined && gateSequence > roll.sequenceNumber;
  });

  if (premature.length > 0) {
    return {
      outcome: 'FAILED',
      actual: premature
        .map((roll) => {
          const payload = roll.payload as DiceRollEventPayload;
          return (
            `sequence ${roll.sequenceNumber}: "${payload.purpose}" declares it was gated ` +
            `by ${payload.gatedByRollId}, which resolved at sequence ` +
            `${bySequence.get(payload.gatedByRollId)} — after it. The consequence was ` +
            'rolled before the roll it depended on'
          );
        })
        .join('; '),
    };
  }

  return {
    outcome: 'PASSED',
    actual:
      `${gated.length} in-turn roll(s) declare a gate and every one of them resolved ` +
      'after the roll it depends on',
    actualCode: 'all in-turn gated rolls follow their gate',
  };
}

/**
 * OUT-OF-ORDER-RESOLUTION: a consequence roll must not fire before the roll
 * that gates it has resolved, and no `dice_roll` may precede the turn's own
 * `player_action`.
 *
 * **The deferred gate is the whole check.** A *pending* `dice_request` is an
 * unresolved gate as a matter of structure — the backend surfaces it to the
 * player and the turn ends waiting on it, so at the moment this turn
 * finished, its outcome was unknown. Any roll the turn resolved on the
 * player's behalf while that request sat pending was therefore resolved
 * ahead of its gate. That is the violation, read off event and request
 * state with nothing inferred from wording.
 *
 * This replaces `CONDITIONAL_DAMAGE_PATTERN`, a regex over `purpose` looking
 * for "damage ... if hit/succeeds/lands". It was the second heuristic this
 * checker had tried (the first grouped rolls by a snake_case entity token
 * that never appears in real purpose text), and it had the failure mode
 * every prose matcher here eventually has: it recognised the idiom of the
 * model that was current when it was written. A Warden that pre-rolls damage
 * and simply doesn't say "if hit" is doing the same wrong thing invisibly.
 * The pending-request signal catches the shape regardless of phrasing, and
 * `decisions.md`'s dividing line says the structural checker may not
 * adjudicate ordering by regex — so it no longer does.
 *
 * **The in-turn case, decided as of M7.5.** When the turn resolves its
 * gating roll in-turn rather than deferring it, the ordering question
 * becomes "which of these rolls depends on which." Nothing in the data used
 * to answer it — sequence numbers show what happened first, not what
 * depended on what, and a to-hit followed by a damage roll is correct while
 * a damage roll followed by a to-hit is not, the same two events in either
 * order. `gatedByRollId` now records the dependency, and
 * `checkInTurnOrdering` below reads it. A roll whose named gate resolved at
 * a *higher* sequence number than itself is the violation.
 *
 * **The guard on the negative assertion.** "No consequence rolled ahead of
 * its gate" is satisfied by absence, so a turn that rolls nothing satisfies
 * it trivially — and a Warden that stopped issuing gating requests entirely
 * would score 1.00 while doing less, not better. Applicability therefore
 * requires an actual pending gating request: no request, no verdict. A rate
 * here can only rise by deferring gates *and* not pre-rolling their
 * consequences, which is the behaviour the check is about.
 *
 * **Known residual false FAIL, measured.** Treating *every* player-attributed
 * roll as a consequence of the pending gate over-reaches: a roll can belong
 * to the player and be properly ordered, because it depends on something
 * that already resolved. The real case in this corpus is a stress/panic
 * check triggered by NPC fire that resolved earlier in the same turn — a
 * legitimately-ordered player roll, flagged here because it cannot be
 * distinguished from a pre-rolled damage roll. Both are GM-initiated, carry
 * no `requestId`, and sit after the gate in sequence; the only difference is
 * a dependency the payload doesn't record. This is the same `gatedByRollId`
 * gap as above, on the other side of the verdict — and unlike the in-turn
 * case it is **not** closed by M7.5. The field records which *roll* gated a
 * roll; the deferred-gate branch asks whether a roll was gated by a pending
 * *request*, which is a different link and still unrecorded. Measured cost
 * on the frozen 4.6 run is unchanged at 1 of 18 decided reps.
 *
 * Measured on the frozen 4.6 run it costs 1 of 18 decided reps
 * (`turn21`, rep 009). Accepted rather than heuristically patched: the
 * available discriminators are `notation` (1d10 damage vs 1d100 check) and
 * `purpose` wording, and adopting either would re-import the "works on the
 * data in front of me" failure that produced `CONDITIONAL_DAMAGE_PATTERN`
 * and its predecessor. A false FAIL also names the offending roll in its
 * `actual` text, so it is visible and diagnosable in a report — unlike the
 * false PASS that the alternative readings risk. For scale, the rule this
 * replaces produced *four* false FAILs on `turn19` alone, all on NPC damage
 * rolls ("Contractor rifle damage if hit") that were never gated by the
 * player's request at all — which is why that fixture read 0/9.
 */
export function checkOutOfOrderResolution(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): StructuralVerdict {
  const applicability = requireApplicability(fixture, CHECK_ID);
  if (!applicability.applies) {
    return { outcome: 'NOT_APPLICABLE', actual: applicability.situation };
  }
  const { playerEntity } = applicability;

  const diceRolls = result.gameEvents
    .filter((e) => e.eventType === 'dice_roll')
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // Independent of any gate: pure sequence numbers, a hard invariant of the
  // write path rather than a claim about dependencies. Checked first because
  // it is definite either way.
  const playerAction = result.gameEvents.find(
    (e) => e.eventType === 'player_action',
  );
  if (playerAction) {
    const precedingRolls = diceRolls.filter(
      (r) => r.sequenceNumber < playerAction.sequenceNumber,
    );
    if (precedingRolls.length > 0) {
      return {
        outcome: 'FAILED',
        actual:
          `${precedingRolls.length} dice_roll event(s) occurred before this ` +
          `turn's player_action (sequence ${playerAction.sequenceNumber}): ` +
          `sequence(s) ${precedingRolls.map((r) => r.sequenceNumber).join(', ')}`,
      };
    }
  }

  // No prose binding on the request side — a `dice_request` is player-facing
  // by construction (`roll_dice` is for GM rolls, `diceRequests` for
  // player-facing ones), so a pending one is an unresolved player gate
  // whatever its purpose text says. See `system-rolled-player-action.ts`,
  // where requiring a leading-name match here was a real false negative.
  const pendingGates = result.diceRequests.filter(
    (r) => r.status === 'pending',
  );

  if (pendingGates.length === 0) {
    return checkInTurnOrdering(diceRolls);
  }

  // Rolls the turn resolved on the player's behalf while a gate sat pending.
  // Attribution is prose here and unavoidably so — `dice_roll` records no
  // acting entity, and an NPC's roll is not gated by the player's pending
  // request, so the two cannot be treated alike. See `attribution.ts`.
  const prematureRolls = diceRolls.filter((roll) =>
    isAttributedTo(purposeOf(roll), playerEntity),
  );

  if (prematureRolls.length > 0) {
    return {
      outcome: 'FAILED',
      actual: prematureRolls
        .map(
          (roll) =>
            `sequence ${roll.sequenceNumber}: "${purposeOf(roll)}" was resolved for ` +
            `${playerEntity} while ${pendingGates.length} dice_request(s) were still ` +
            `pending (e.g. "${pendingGates[0].purpose}") — its gate had not resolved ` +
            'when this turn ended',
        )
        .join('; '),
    };
  }

  return {
    outcome: 'PASSED',
    actual:
      `${pendingGates.length} dice_request(s) pending at end of turn (e.g. ` +
      `"${pendingGates[0].purpose}") and no roll was resolved for ${playerEntity} ` +
      'ahead of them',
    actualCode: `gate deferred for ${playerEntity}, no premature consequence roll`,
  };
}
