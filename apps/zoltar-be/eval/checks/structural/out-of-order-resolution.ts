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
 * **What is deliberately not decided.** When the turn resolves its gating
 * roll in-turn rather than deferring it, the ordering question becomes
 * "which of these rolls depends on which," and nothing in the data answers
 * it: `dice_roll` carries no link to the roll that gated it. Sequence
 * numbers show what happened first, not what depended on what, and a
 * to-hit followed by a damage roll is correct while a damage roll followed
 * by a to-hit is not — the same two events in either order, distinguishable
 * only by a dependency the payload doesn't record. That needs
 * `gatedByRollId` on the roll payload (anticipated in
 * `eval/checks/registry.ts`). Until it exists, this shape reports
 * `NOT_APPLICABLE` naming the missing field rather than guessing.
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
 * gap as above, on the other side of the verdict.
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
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'no dice_request is pending at the end of this turn, so there is no unresolved ' +
        'gate to order anything against. Any ordering violation among the ' +
        `${diceRolls.length} roll(s) resolved in-turn would need each roll's ` +
        '`gatedByRollId` to identify which roll gated which — the payload records no ' +
        'such link, and sequence order alone shows what happened first, not what ' +
        'depended on what',
      actualCode:
        'no pending dice_request; in-turn ordering undecidable without gatedByRollId',
    };
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
