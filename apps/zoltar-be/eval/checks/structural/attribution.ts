import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

/**
 * Binds a roll to the acting entity by the Warden's own naming convention:
 * purpose text leads with the acting entity's name ("Alvarez rifle damage if
 * hit"). `startsWith`, not `includes`, so a roll that merely *mentions* the
 * player as a target ("Contractor rifle damage to Alvarez if hit lands") is
 * correctly excluded — it doesn't start with the player's name, only
 * contains it.
 *
 * **This was the last prose dependency in the structural checks. M7.5 added
 * the field that replaces it, and this function is now the fallback rather
 * than the mechanism** — see :func:`rollActsFor`, which prefers
 * `actingEntityId` and only reaches here when the payload has none.
 *
 * Kept, rather than deleted, because `eval:rescore` re-grades frozen
 * `warden-output.json` artifacts from the `88fa84bd8329` runs, which predate
 * the field entirely. Deleting this would turn every historical artifact
 * into an error and silently un-pair the comparison history `eval:compare`
 * is built on.
 *
 * Because it is prose, it fails the way prose matching always fails here —
 * silently, by not matching, which reads as "the player's action doesn't
 * appear in this turn." `unbindableVerdict` below exists so that failure
 * mode reports as undecided instead of as a pass.
 */
export function isAttributedTo(purpose: string, playerEntity: string): boolean {
  return purpose.toLowerCase().startsWith(playerEntity.toLowerCase());
}

/**
 * Who a roll acted for. Three states, not two — see `rollActsFor`.
 *
 * `'unknown'` is not a soft `'other'`. It means the payload named an entity
 * this fixture cannot identify, so *neither* answer is available, and a
 * caller that folds it into `'other'` reproduces the false pass described
 * below.
 */
export type Attribution = 'player' | 'other' | 'unknown';

/** The identity facts a fixture supplies for attribution. Built once per
 * check by `attributionContext`. */
export interface AttributionContext {
  /** Display name, for the prose fallback: `"Alvarez"`. */
  playerEntity: string;
  /** Entity *ids* the player character answers to: `["lt_alvarez", ...]`. */
  playerEntityIds: readonly string[];
  /** Every entity id the fixture's seeded state declares — NPCs, threats,
   * features. Does **not** include the player (see `attributionContext`). */
  knownEntityIds: readonly string[];
}

/**
 * Does this `dice_roll` act for the player?
 *
 * **Branches on field presence, never on `fixtureSchemaVersion`.** The
 * fixture's version records what `capture-fixture` captured, and it captures
 * no game events at all — these fields appear in the *live turn's* output,
 * which is generated fresh at run time. So the only honest test is whether
 * this particular payload carries the field, which is also exactly what
 * makes re-scoring pre-M7.5 artifacts produce the same verdicts it always
 * did.
 *
 * **Why this returns three states, and the bug that forced it.** M7.5's first
 * cut compared `actingEntityId` to `playerEntity` for equality and returned a
 * boolean. Those are different namespaces: the field carries an entity id
 * (`lt_alvarez`) and `playerEntity` carries a display name (`Alvarez`), so
 * every player roll compared unequal and read as "not the player." The result
 * was not a missing verdict but a *wrong* one — `system-rolled-player-action`
 * scored 20/20 on a run whose turn19 rep 001 contains
 * `system_generated` / `lt_alvarez` / "Alvarez Combat Check to shoot
 * contractor alpha", which is the violation the check exists to catch, stated
 * in the payload. It shipped, and the 60 structural tests passed throughout,
 * because the specs pair `actingEntityId: 'alvarez'` with
 * `playerEntity: 'Alvarez'` and the two namespaces coincide only there.
 * (`docs/rules-extraction-findings.md § S30`.)
 *
 * So an id is resolved against declared id *sets*, and an id in neither set
 * is `'unknown'`. That third state is load-bearing: Sonnet 4.6 emits resource
 * pool names (`lt_alvarez_hp`, `alvarez_armor`) in this field 13 times across
 * the frozen run, and those rolls must cost a denominator rather than be
 * silently sorted into "an NPC did it."
 */
export function rollActsFor(
  roll: TurnExecutionResult['gameEvents'][number],
  ctx: AttributionContext,
): Attribution {
  const payload = roll.payload as DiceRollEventPayload;
  const actingEntityId = payload.actingEntityId;

  // Pre-M7.5 artifact: the prose convention, grading exactly as it always
  // did. Never `'unknown'` — the leading-name convention's failure mode is
  // handled by `unbindableVerdict`, which predates this and still owns it.
  if (actingEntityId === undefined) {
    return isAttributedTo(payload.purpose ?? '', ctx.playerEntity)
      ? 'player'
      : 'other';
  }

  // A fixture that declares no player ids cannot answer the question at all.
  // Failing open to `'other'` here is precisely the shipped bug.
  if (ctx.playerEntityIds.length === 0) return 'unknown';

  const needle = actingEntityId.toLowerCase();
  const matches = (id: string) => id.toLowerCase() === needle;

  if (ctx.playerEntityIds.some(matches)) return 'player';
  if (ctx.knownEntityIds.some(matches)) return 'other';

  // Named something that is neither the player nor any entity this fixture
  // declares. Most often a resource pool name. It cannot be ruled out as the
  // player under an id we don't know about, so it is undecided.
  return 'unknown';
}

/** True when the payload carries the structural attribution field. */
export function hasActingEntity(
  roll: TurnExecutionResult['gameEvents'][number],
): boolean {
  return (roll.payload as DiceRollEventPayload).actingEntityId !== undefined;
}

/**
 * Builds the identity facts for a fixture.
 *
 * `playerEntityIds` is read from the seeded `gmContextBlob` — the same field
 * `SessionService` populates from `character_sheet.data.entityId` and hands
 * to the prompt builder — rather than from a second hand-authored field on
 * `applicability`. One source, so the checker and the product cannot drift
 * apart about who the player is.
 *
 * `knownEntityIds` deliberately excludes the player: `campaign_state.entities`
 * holds NPCs, threats, and features only, which is why
 * `buildStateSnapshot` needs `playerEntityIds` as a separate override at all.
 */
export function attributionContext(
  fixture: EvalFixture,
  playerEntity: string,
): AttributionContext {
  const blob = fixture.seededState.gmContextBlob as {
    playerEntityIds?: unknown;
  };
  const playerEntityIds = Array.isArray(blob.playerEntityIds)
    ? blob.playerEntityIds.filter((v): v is string => typeof v === 'string')
    : [];

  const entities = (
    fixture.seededState.campaignState as { entities?: Record<string, unknown> }
  ).entities;

  return {
    playerEntity,
    playerEntityIds,
    knownEntityIds: entities ? Object.keys(entities) : [],
  };
}

function rollPurpose(roll: TurnExecutionResult['gameEvents'][number]): string {
  return (roll.payload as DiceRollEventPayload).purpose ?? '';
}

/**
 * The guard against `isAttributedTo` failing silently.
 *
 * A checker reaches this point having found nothing bound to `playerEntity`.
 * Two different situations produce that, and they are not
 * interchangeable:
 *
 * 1. **The turn contains no rolls or pending requests at all.** Nothing was
 *    resolved system-side because nothing was resolved at all — a structural
 *    fact, independent of any prose. The caller may report it however its
 *    own assertion reads; this function returns `null` and stays out of the
 *    way.
 *
 * 2. **The turn contains rolls or requests, none of which bound.** They may
 *    genuinely all belong to NPCs, or one of them may be the player's own
 *    action phrased in a way the leading-name convention missed. Those two
 *    readings are indistinguishable from the data, and they carry opposite
 *    verdicts — a pass, or exactly the violation the check exists to catch.
 *    Returning a pass here is the false-pass shape that has already bitten
 *    `system-rolled-player-action` once (a system-rolled to-hit its
 *    damage-only matcher didn't recognize) and `unsurfaced-check` before
 *    that. So this reports `NOT_APPLICABLE` — undecided, excluded from the
 *    denominator, and named — rather than guessing.
 *
 * Costing a denominator is the point, not a side effect: a rep whose verdict
 * rests on a prose match having failed is not evidence, and counting it as
 * one is how a rate reaches 1.00 without the behaviour improving.
 */
export function unbindableVerdict(
  result: TurnExecutionResult,
  ctx: AttributionContext,
): StructuralVerdict | null {
  const { playerEntity } = ctx;
  // Only `dice_roll` events are considered. A `dice_request` needs no prose
  // binding at all — it is player-facing by construction (see
  // `system-rolled-player-action.ts`), so its presence is structural
  // evidence a caller can act on directly rather than an ambiguity.
  const rolls = result.gameEvents.filter((e) => e.eventType === 'dice_roll');

  // A roll whose `actingEntityId` *resolves* is never unbindable: it named
  // its entity, and that the entity is not the player is an answer rather
  // than a failure to match — otherwise a turn whose rolls all legitimately
  // belong to NPCs would keep costing a denominator forever after the field
  // that resolved it had shipped.
  //
  // But an id that resolves to nothing is exactly as open a question as a
  // prose match that failed, and for the same reason: the roll may be the
  // player's under an id this fixture doesn't know. The M7.5 first cut
  // excluded every roll carrying the field regardless of whether it resolved,
  // which disarmed this guard against the one input it most needed to catch
  // — 4.6's resource-pool-name ids. `'unknown'` therefore keeps a roll in
  // `unboundRolls`, the same as a failed prose match.
  const unboundRolls = rolls.filter((roll) => {
    const attribution = rollActsFor(roll, ctx);
    if (attribution === 'unknown') return true;
    return !hasActingEntity(roll) && attribution !== 'player';
  });

  if (unboundRolls.length === 0) return null;

  // The two causes are reported apart because they call for different fixes:
  // a failed prose match is closed by the Warden emitting `actingEntityId` at
  // all, an unresolvable id by the *fixture* declaring the id or the Warden
  // being taught to stop naming resource pools. Collapsing them would hide
  // which one is growing.
  const unresolved = unboundRolls.filter((r) => hasActingEntity(r));
  const proseOnly = unboundRolls.filter((r) => !hasActingEntity(r));
  const describe = (r: (typeof unboundRolls)[number]) =>
    `dice_roll "${rollPurpose(r)}"`;

  if (unresolved.length > 0) {
    const named = unresolved.map(
      (r) =>
        `${describe(r)} (actingEntityId "${(r.payload as DiceRollEventPayload).actingEntityId}")`,
    );
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        `${unresolved.length} system-side roll(s) name an actingEntityId that is neither a ` +
        `declared player entity id nor any entity in this fixture's seeded state: ${named.join('; ')}. ` +
        `The id may be ${playerEntity} under a name this fixture does not declare, or a ` +
        'resource pool name emitted in an entity field — those carry opposite verdicts and ' +
        'the turn data cannot distinguish them. Undecided rather than guessed.',
      actualCode:
        'system-side roll names an actingEntityId matching no declared player or seeded entity',
    };
  }

  const candidates = proseOnly.map(describe);

  return {
    outcome: 'NOT_APPLICABLE',
    actual:
      `no dice_roll binds to ${playerEntity} by the leading-name convention and no ` +
      `dice_request was surfaced, but ${candidates.length} system-side roll(s) are ` +
      `present that cannot be attributed to any entity structurally: ${candidates.join('; ')}. ` +
      `They may all belong to NPCs, or one may be ${playerEntity}'s own action phrased ` +
      'without a leading name — the turn data cannot distinguish those, and they carry ' +
      'opposite verdicts. Undecided rather than guessed; needs `actingEntityId` on the ' +
      'roll payload to resolve.',
    // Every interpolation above is per-rep-variable (the Warden generates
    // this text fresh each rep), so exclusion aggregation groups on this
    // fixture-constant key instead — see `StructuralVerdict.actualCode`.
    actualCode: `no roll binds to ${playerEntity} and no dice_request was surfaced, but unattributable system-side rolls are present`,
  };
}
