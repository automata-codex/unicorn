import {
  CONDITIONS_REQUIRING_PARAMETER,
  EntityStatusSchema,
  emptyMothershipCharacterState,
  isInvalidReservedPoolOwner,
  type MothershipCampaignState,
  type MothershipCharacterState,
  type PoolDefinition,
} from '@uv/game-systems';
import { z } from 'zod';

import type {
  CharacterStateChange,
  ResourcePoolChange,
  SubmitGmResponse,
} from './session.schema';

type ResourcePoolValue = { current: number; max: number | null };

type EntityStatus = z.infer<typeof EntityStatusSchema>;

export interface ValidationRejection {
  path: string;
  reason: string;
  received: unknown;
}

export interface ThresholdCrossing {
  pool: string;
  finalValue: number;
  effect: string;
}

export interface ValidationResult {
  applied: {
    /** `resourcePools[owner][poolName]`, matching campaign state's shape. */
    resourcePools: Record<string, Record<string, ResourcePoolValue>>;
    /** Whole replacement per entity, not a diff — see `foldCharacterState`. */
    characterState: Record<string, MothershipCharacterState>;
    entities: Record<
      string,
      {
        visible: boolean;
        revealed: boolean;
        status: EntityStatus;
        npcState?: string;
      }
    >;
    flags: Record<string, { value: boolean; trigger: string }>;
    scenarioState: Record<
      string,
      { current: number; max: number | null; note: string }
    >;
    worldFacts: Record<string, string>;
  };
  /**
   * Validated `gmUpdates.npcAgendas`. Kept beside `applied` rather than in it
   * because `applied` is the campaign-state half and is persisted verbatim as
   * `state_update.payload.applied`; agendas live in the `gm_context` blob.
   */
  npcAgendas: Record<string, string>;
  rejections: ValidationRejection[];
  thresholds: ThresholdCrossing[];
}

export function validateStateChanges(input: {
  proposed: SubmitGmResponse['stateChanges'];
  /**
   * `gmUpdates.npcAgendas`, validated here so an agenda amendment goes through
   * the same validate-then-apply discipline as everything else. Until
   * `ADR-0101` it bypassed validation entirely and was spread over the prior
   * agendas in the applier.
   */
  proposedNpcAgendas?: Record<string, string>;
  /** Prior `narrative.npcAgendas`, for the "does this key exist" check. */
  currentNpcAgendas?: Record<string, string>;
  currentData: MothershipCampaignState;
  poolDef: (poolName: string) => PoolDefinition;
  /**
   * Identifier namespaces the pool-bootstrap branch resolves prefixes against:
   * the player ids from `character_sheet`, and the entities the snapshot could
   * have shown. Optional so callers that predate it (and the pure unit specs)
   * keep working — an absent set disables the impersonation check rather than
   * rejecting everything, the same asymmetry `roll_dice` uses for an empty
   * known set (`docs/decisions.md § actingEntityId must resolve against a
   * declared identifier set`).
   */
  identifiers?: {
    playerEntityIds: readonly string[];
    knownEntityIds: readonly string[];
  };
}): ValidationResult {
  const result: ValidationResult = {
    applied: {
      resourcePools: {},
      characterState: {},
      entities: {},
      flags: {},
      scenarioState: {},
      worldFacts: {},
    },
    npcAgendas: {},
    rejections: [],
    thresholds: [],
  };

  const proposed = input.proposed ?? {};

  applyNpcAgendas(
    input.proposedNpcAgendas ?? {},
    input.currentNpcAgendas ?? {},
    input.currentData,
    result,
  );

  // **Creates run first, and widen the identifier set for the rest of the
  // turn.** A newly introduced NPC is a legal resource-pool owner immediately
  // — without this, `new_npc.hp` would trip `impersonatesPlayerPool`, which
  // rejects an *unknown* owner whose pool name matches one the player owns.
  // That is the correct rule for an id nobody declared and the wrong one for
  // an id declared four lines earlier in the same payload.
  const createdEntityIds = applyNewEntities(
    proposed.newEntities ?? {},
    input.currentData,
    result,
  );

  const identifiers =
    input.identifiers && createdEntityIds.length > 0
      ? {
          ...input.identifiers,
          knownEntityIds: [
            ...input.identifiers.knownEntityIds,
            ...createdEntityIds,
          ],
        }
      : input.identifiers;

  const pools = foldResourcePools(
    proposed.resourcePools ?? [],
    input.currentData,
    input.poolDef,
    identifiers,
  );
  const characters = foldCharacterState(
    proposed.characterState ?? [],
    input.currentData,
  );

  // **Cross-member atomicity.** A rejection in either fold aborts both. The
  // wounds chain writes both halves — HP to zero, the Wound recorded, bleeding
  // set from the table, HP reset — and half of that is a state Mothership has
  // no rule for. D4's three arguments apply unchanged at the array level.
  //
  // This is stronger than transactional atomicity and does not depend on it:
  // `validateStateChanges` accumulates across every `stateChanges` member and
  // returns one pass/fail, and `SessionService` throws before
  // `applyValidatedTurn` runs, so on rejection nothing reaches the applier at
  // all. The guarantee is **validate-all-then-apply**. Recorded here because a
  // guarantee that holds by accident is one refactor away from not holding —
  // see `roadmap.md § Prerequisite — turn-path lock audit`, which exists
  // because exactly this went unrecorded once already.
  const foldRejections = [...pools.rejections, ...characters.rejections];
  if (foldRejections.length === 0) {
    result.applied.resourcePools = pools.applied;
    result.applied.characterState = characters.applied;
    result.thresholds = pools.thresholds;
  } else {
    result.rejections.push(...foldRejections);
  }

  for (const [entityId, change] of Object.entries(proposed.entities ?? {})) {
    applyEntity(entityId, change, input.currentData, result);
  }

  for (const [flagName, change] of Object.entries(proposed.flags ?? {})) {
    applyFlag(flagName, change, input.currentData, result);
  }

  for (const [key, change] of Object.entries(proposed.scenarioState ?? {})) {
    applyScenarioState(key, change, input.currentData, result);
  }

  for (const [key, value] of Object.entries(proposed.worldFacts ?? {})) {
    result.applied.worldFacts[key] = value;
  }

  return result;
}

/**
 * True when `owner` is a spelling of the player's id that nothing declares,
 * carrying a pool of a kind the player already owns — `alvarez.hp` while the
 * sheet says `lt_alvarez`. Scenario-level owners that resolve to nothing but
 * name no player pool (`_scenario.station_power_reserve`) are unaffected.
 *
 * Still two clauses, and both are load-bearing. Nesting removed the string
 * slicing this used to need — the pool-name comparison is now a set
 * intersection — but not the `!known.has(owner)` guard. Dropping to a bare "is
 * the owner a player entity id" test would reject every legitimate NPC pool:
 * `decommissioned_android.hp` names a pool of a kind the player owns, and it
 * survives only because its owner is in `knownEntityIds`.
 */
function impersonatesPlayerPool(
  owner: string,
  poolName: string,
  currentData: MothershipCampaignState,
  identifiers: {
    playerEntityIds: readonly string[];
    knownEntityIds: readonly string[];
  },
): boolean {
  const known = new Set([
    ...identifiers.playerEntityIds,
    ...identifiers.knownEntityIds,
  ]);
  if (known.has(owner)) return false;
  return identifiers.playerEntityIds.some((playerId) =>
    Object.hasOwn(currentData.resourcePools[playerId] ?? {}, poolName),
  );
}

/**
 * Folds `stateChanges.resourcePools` **in order against a running state**.
 *
 * Order is information: the wounds chain drives `hp.current` to zero, then
 * resets it to `hp.max` minus carryover — two entries against one pool in one
 * turn, with different reasons. Validating each independently against the
 * pre-turn state would reject the second, or accept a pair that no sequence of
 * events explains.
 *
 * **Rejection is all-or-nothing per turn (D4).** The first rejected entry
 * aborts the whole array and nothing is applied. Three reasons: §2.2's
 * `sum(deltas) == current − initial` property holds only if the recorded and
 * applied deltas are the same set; the correction loop is bounded at one
 * re-prompt, so applying entries one and two would ask the Warden to fix entry
 * three against a world that moved underneath it, which it has no way to see;
 * and a half-applied wounds chain leaves a character at 0 HP with no Wound
 * recorded, a state Mothership has no rule for.
 *
 * **The fold runs on a working copy.** `currentData` is never mutated, so an
 * abort at entry three leaves the pool entry one targeted byte-identical to its
 * pre-turn value. Folding by mutating the state being read is the easy way to
 * write this and it voids D4's guarantee — partial application becomes possible
 * despite a clean abort.
 */
function foldResourcePools(
  entries: readonly ResourcePoolChange[],
  currentData: MothershipCampaignState,
  poolDef: (poolName: string) => PoolDefinition,
  identifiers?: {
    playerEntityIds: readonly string[];
    knownEntityIds: readonly string[];
  },
): {
  applied: ValidationResult['applied']['resourcePools'];
  rejections: ValidationRejection[];
  thresholds: ThresholdCrossing[];
} {
  // Working copy, one owner deep — enough, because the leaves are replaced
  // wholesale rather than edited in place.
  const working: Record<string, Record<string, ResourcePoolValue>> = {};
  for (const [owner, pools] of Object.entries(currentData.resourcePools)) {
    working[owner] = { ...pools };
  }

  const applied: ValidationResult['applied']['resourcePools'] = {};
  const thresholds: ThresholdCrossing[] = [];

  for (const [index, change] of entries.entries()) {
    const path = `resourcePools[${index}] (${change.owner}.${change.pool})`;
    const reject = (reason: string) => ({
      applied: {},
      rejections: [{ path, reason, received: change }],
      thresholds: [],
    });

    if (isInvalidReservedPoolOwner(change.owner)) {
      return reject(
        `Owner "${change.owner}" claims the reserved leading-underscore ` +
          'namespace. The only reserved owner is "_scenario", for pools ' +
          'belonging to no entity. Entity ids never begin with an underscore.',
      );
    }

    const def = poolDef(change.pool);
    const existing = working[change.owner]?.[change.pool];

    if (!existing) {
      if (change.maxDelta !== undefined) {
        return reject(
          'maxDelta was sent for a pool that does not exist yet. Bootstrap ' +
            'the pool with a positive delta first.',
        );
      }
      if (
        identifiers &&
        identifiers.playerEntityIds.length > 0 &&
        impersonatesPlayerPool(
          change.owner,
          change.pool,
          currentData,
          identifiers,
        )
      ) {
        // Bootstrapping this would give one character two pools of the same
        // kind under two spellings of their id — the defect that made the M7.5
        // capture's `actingEntityId` values unresolvable. Named ids in the
        // reason so the model corrects in-loop rather than retrying blind.
        return reject(
          `Owner "${change.owner}" does not resolve to a known entity, and ` +
            `the player character already has a "${change.pool}" pool. The ` +
            `player's entity id is ${identifiers.playerEntityIds.join(' or ')}` +
            ' — use that exact spelling as the owner.',
        );
      }
      if (change.delta <= 0) {
        return reject(
          'Pool does not exist — bootstrap with a positive delta before ' +
            'applying damage or spending.',
        );
      }
      record(working, applied, change.owner, change.pool, {
        current: change.delta,
        max: null,
      });
      continue;
    }

    // Rule: a ceiling delta on an uncapped pool would hide a Warden error —
    // there is no ceiling to move, so the request means something the Warden
    // has not said out loud.
    if (change.maxDelta !== undefined && existing.max === null) {
      return reject(
        `Pool "${change.owner}.${change.pool}" has no ceiling, so maxDelta ` +
          'has nothing to change. Send delta alone.',
      );
    }

    const newCurrent = existing.current + change.delta;
    const newMax =
      existing.max === null ? null : existing.max + (change.maxDelta ?? 0);

    // Rule: reject below the floor rather than clamping. The Warden applies
    // the floor, and a clamp would silently turn a wrong number into a
    // plausible one.
    if (def.min !== null && newCurrent < def.min) {
      return reject(
        def.min === 0
          ? `Cannot spend more than available: ${change.owner}.${change.pool} ` +
              `is at ${existing.current} and this would take it to ${newCurrent}.`
          : `Pool value would drop below minimum (${def.min}).`,
      );
    }

    if (def.max !== null && newCurrent > def.max) {
      return reject(`Pool value would exceed maximum (${def.max}).`);
    }

    // Rule: the ceiling and the current value must end up consistent, and both
    // deltas must be sent to get there. Note this permits a `delta` *larger*
    // than the minimum needed — a Death table result that lowers Maximum
    // Health by 4 while dealing 6 damage sends both, and only the ceiling
    // constrains the pair. Narrowing this to "delta exactly closes the gap"
    // would discard whatever damage exceeded it.
    if (newMax !== null && newCurrent > newMax) {
      return reject(
        `Pool value ${newCurrent} would exceed its ceiling ${newMax}. If an ` +
          'effect lowers the ceiling below the current value, send the delta ' +
          'that actually occurred alongside maxDelta.',
      );
    }

    record(working, applied, change.owner, change.pool, {
      current: newCurrent,
      max: newMax,
    });

    // Thresholds fire only on downward crossings (negative delta). The spec's
    // formal rule in §"Part 2 → resourcePools → 3" lists a symmetric positive-
    // delta case as well, but the spec test list is explicit that HP healed
    // from -1 to +2 does not fire (already past it). The asymmetric reading
    // satisfies the concrete test; no M6 pool carries an upward-violation
    // threshold. Revisit if such a threshold is introduced.
    for (const t of def.thresholds) {
      if (
        change.delta < 0 &&
        existing.current >= t.value &&
        newCurrent < t.value
      ) {
        thresholds.push({
          pool: `${change.owner}.${change.pool}`,
          finalValue: newCurrent,
          effect: t.effect,
        });
      }
    }
  }

  return { applied, rejections: [], thresholds };
}

function record(
  working: Record<string, Record<string, ResourcePoolValue>>,
  applied: ValidationResult['applied']['resourcePools'],
  owner: string,
  poolName: string,
  pool: ResourcePoolValue,
): void {
  (working[owner] ??= {})[poolName] = pool;
  (applied[owner] ??= {})[poolName] = pool;
}

/**
 * Folds `stateChanges.characterState` in order, on a working copy, with the
 * same all-or-nothing rejection as the pool fold and for the same reasons.
 *
 * The applied value per entity is the entity's **whole new state**, not a diff:
 * the ops edit nested arrays, and a diff of an array edit is not a thing the
 * applier could merge without re-deriving the fold.
 */
function foldCharacterState(
  entries: readonly CharacterStateChange[],
  currentData: MothershipCampaignState,
): {
  applied: Record<string, MothershipCharacterState>;
  rejections: ValidationRejection[];
} {
  const working: Record<string, MothershipCharacterState> = {};
  const touched = new Set<string>();

  const stateFor = (entityId: string): MothershipCharacterState => {
    if (!working[entityId]) {
      const existing = currentData.characterState?.[entityId];
      // Bootstrap for an entity with none. NPCs get no state at creation —
      // only player characters do — and an NPC can bleed.
      // Spread over the empty state rather than cloning raw: `campaign_state`
      // is JSONB read without re-parsing, so a row written before a field
      // existed simply lacks the key and Zod's default never runs. Backfilling
      // here covers `rollModifiers` and anything added after it.
      working[entityId] = existing
        ? { ...emptyMothershipCharacterState(), ...structuredClone(existing) }
        : emptyMothershipCharacterState();
    }
    return working[entityId];
  };

  for (const [index, change] of entries.entries()) {
    const path = `characterState[${index}] (${change.op} ${change.entityId})`;
    const reject = (reason: string) => ({
      applied: {},
      rejections: [{ path, reason, received: change }],
    });
    const state = stateFor(change.entityId);
    touched.add(change.entityId);

    switch (change.op) {
      case 'condition_add': {
        const needsParameter = CONDITIONS_REQUIRING_PARAMETER.includes(
          change.condition,
        );
        if (needsParameter && change.parameter === undefined) {
          return reject(
            `"${change.condition}" requires a parameter. ` +
              (change.condition === 'frightened'
                ? 'Record what frightened the character.'
                : 'Record which skill loses its bonus.'),
          );
        }
        if (!needsParameter && change.parameter !== undefined) {
          return reject(
            `"${change.condition}" takes no parameter. Only "frightened" and ` +
              '"loss_of_confidence" carry one.',
          );
        }
        if (
          change.condition === 'loss_of_confidence' &&
          change.parameter !== undefined &&
          !state.skills.some((s) => s.skill === change.parameter)
        ) {
          // The parameter is a link into the skills list, not a label. A name
          // that resolves to nothing suppresses nothing, silently.
          const held = state.skills.map((s) => s.skill).join(', ');
          return reject(
            `"${change.parameter}" is not a skill this character has, so ` +
              'nothing would be suppressed. ' +
              (held
                ? `They have: ${held}.`
                : 'They have no skills recorded at all.'),
          );
        }
        if (state.conditions.some((c) => c.condition === change.condition)) {
          return reject(
            `The character already has "${change.condition}". Conditions do ` +
              'not stack.',
          );
        }
        state.conditions = [
          ...state.conditions,
          change.parameter === undefined
            ? { condition: change.condition }
            : { condition: change.condition, parameter: change.parameter },
        ];
        break;
      }

      case 'roll_modifier_add': {
        if (change.scope === 'all_rolls' && change.target !== undefined) {
          return reject(
            '"all_rolls" applies to everything, so it takes no target. ' +
              `Received "${change.target}".`,
          );
        }
        if (change.scope !== 'all_rolls' && !change.target) {
          return reject(
            `Scope "${change.scope}" names what it applies to, so target is ` +
              'required.',
          );
        }
        // `source` is the key a removal names, so two modifiers may not share
        // one — otherwise a remove would clear an effect nobody asked to clear.
        if (state.rollModifiers.some((m) => m.source === change.source)) {
          return reject(
            `A modifier from "${change.source}" already exists. Sources are ` +
              'the key a removal names and must be distinct.',
          );
        }
        state.rollModifiers = [
          ...state.rollModifiers,
          {
            effect: change.effect,
            scope: change.scope,
            ...(change.target !== undefined ? { target: change.target } : {}),
            source: change.source,
          },
        ];
        break;
      }

      case 'roll_modifier_remove': {
        if (!state.rollModifiers.some((m) => m.source === change.source)) {
          return reject(
            `No modifier from "${change.source}", so there is nothing to ` +
              'remove.',
          );
        }
        state.rollModifiers = state.rollModifiers.filter(
          (m) => m.source !== change.source,
        );
        break;
      }

      case 'condition_remove': {
        if (!state.conditions.some((c) => c.condition === change.condition)) {
          return reject(
            `The character does not have "${change.condition}", so there is ` +
              'nothing to remove.',
          );
        }
        // Removing `loss_of_confidence` restores the suppressed skill by
        // construction: the condition entry was the only record of it.
        state.conditions = state.conditions.filter(
          (c) => c.condition !== change.condition,
        );
        break;
      }

      case 'armor_damage': {
        // **AP is a threshold, not a pool.** A character ignores all Damage
        // *less than* their AP; a single hit at or above AP destroys the armor
        // and the remainder lands. Armor is never worn down across several
        // hits — `docs/rules-extraction-findings.md § S25.6`, recorded from
        // reading PSG p.28, which names "subtract armor from each hit" as the
        // error a Warden defaults to. The live Warden prompt states the same
        // rule.
        //
        // M7.6's spec §1.3 and the reconciled diff §5 both say "AP is
        // consumed", and both are wrong on this point. The tool shape they
        // specify is kept — `{ apDelta, destroyed }` — but the only AP change
        // damage can produce is to zero, so that is what the validator
        // enforces. A hit below AP changes nothing and must not be sent.
        //
        // If the spec turns out to be right after all, relaxing this is one
        // condition; recorded for Part 10's closeout either way.
        if (change.apDelta >= 0) {
          return reject(
            'apDelta must be negative. AP is never restored by a change of ' +
              'this kind; patching or replacing the item is an equipment ' +
              'operation, which has no write path in this milestone.',
          );
        }
        if (!state.wornArmor) {
          return reject('The character is not wearing armor to damage.');
        }
        if (state.wornArmor.destroyed) {
          return reject(
            'The armor is already destroyed. Damage Reduction still applies ' +
              'and is unaffected, but there is no AP left to lose.',
          );
        }

        const destroys = state.wornArmor.apCurrent + change.apDelta <= 0;
        if (!destroys) {
          return reject(
            `Armor Points are a threshold, not a pool: ${state.wornArmor.item}` +
              ` has AP ${state.wornArmor.apCurrent}, and a hit below that is ` +
              'ignored entirely rather than wearing the armor down. Send this ' +
              'only when a single hit met or exceeded AP, with an apDelta ' +
              'that takes it to zero.',
          );
        }
        if (change.destroyed !== true) {
          // Rejected rather than derived: keeping the Warden's understanding
          // and the recorded state in agreement is what surfaces the case
          // where it has misread the rule.
          return reject(
            `A hit taking ${state.wornArmor.item} from AP ` +
              `${state.wornArmor.apCurrent} by ${change.apDelta} destroys it, ` +
              'so this change must carry destroyed: true.',
          );
        }

        // DR is untouched: it applies first and survives both destruction and
        // Anti-Armor, which is why it is a separate field.
        state.wornArmor = {
          ...state.wornArmor,
          apCurrent: 0,
          destroyed: true,
        };
        break;
      }

      case 'bleeding_set':
        state.bleeding = change.value;
        break;

      case 'death_save_pending':
        state.pendingDeathSave = change.roundsRemaining;
        break;

      case 'minimum_stress_set':
        // `value >= 2` is enforced by the schema. It is a **scope bound, not a
        // rules invariant**: nothing in M7.6 lowers Minimum Stress below 2 —
        // creation seeds 2, Panic raises it, Psychosurgery resets it *to* 2.
        // Deep Tissue Nanogel Massage lowers it by 1 and is the one effect
        // that could go below, but no medical treatment has a write path here.
        // Revisit when treatments land; the RAW is genuinely ambiguous.
        state.minimumStress = change.value;
        break;
    }
  }

  const applied: Record<string, MothershipCharacterState> = {};
  for (const entityId of touched) applied[entityId] = working[entityId];
  return { applied, rejections: [] };
}

/**
 * Validates `gmUpdates.npcAgendas`.
 *
 * **An agenda key must already name something.** Either an entity in play, or
 * an agenda synthesis already authored — the second clause exists because
 * synthesis may write an agenda for an NPC it never added to
 * `campaign_state.entities`, and refusing to let the Warden amend one of those
 * would make it unmaintainable.
 *
 * What it rejects is a key that names neither, which is how
 * `deep_space_cartographer_reyes_note` came to exist in the 2026-08-16
 * playtest: the Warden needed somewhere to park a cross-cutting observation
 * and this map was the only writable string store in reach. That is what
 * `gmUpdates.notes` is for.
 */
function applyNpcAgendas(
  proposed: Record<string, string>,
  currentAgendas: Record<string, string>,
  currentData: MothershipCampaignState,
  result: ValidationResult,
): void {
  for (const [entityId, agenda] of Object.entries(proposed)) {
    const namesSomething =
      currentData.entities[entityId] !== undefined ||
      Object.hasOwn(currentAgendas, entityId);

    if (!namesSomething) {
      result.rejections.push({
        path: `gmUpdates.npcAgendas.${entityId}`,
        reason:
          `"${entityId}" is neither an entity in play nor an NPC with an ` +
          'existing agenda. An agenda belongs to a specific NPC; for an ' +
          'observation that is not about one, use `gmUpdates.notes`.',
        received: { [entityId]: agenda },
      });
      continue;
    }

    result.npcAgendas[entityId] = agenda;
  }
}

/**
 * Validates `stateChanges.newEntities` and returns the ids actually created.
 *
 * Creation used to be a side effect of naming an unrecognized id in
 * `entities`, which made a genuine mid-adventure NPC indistinguishable from a
 * typo — the first is ordinary play, the second silently forks one entity into
 * two records that then drift apart. `ADR-0101` made creation something a turn
 * has to say out loud.
 *
 * Runs before the resource-pool fold so a created id is a legal pool owner for
 * the rest of the turn; the returned ids are what widen that set.
 */
function applyNewEntities(
  proposed: Record<
    string,
    {
      visible: boolean;
      revealed: boolean;
      status?: EntityStatus;
      npcState?: string;
    }
  >,
  currentData: MothershipCampaignState,
  result: ValidationResult,
): string[] {
  const created: string[] = [];

  for (const [entityId, change] of Object.entries(proposed)) {
    if (currentData.entities[entityId] !== undefined) {
      result.rejections.push({
        path: `newEntities.${entityId}`,
        reason:
          `an entity with id "${entityId}" is already in play. ` +
          'Use `entities` to change one that exists; `newEntities` is only ' +
          'for introducing one that does not.',
        received: change,
      });
      continue;
    }

    // The same invariant the synthesis schema enforces: an entity in line of
    // sight has necessarily been discovered.
    if (change.visible && !change.revealed) {
      result.rejections.push({
        path: `newEntities.${entityId}`,
        reason:
          'an entity in line of sight has been discovered — `visible: true` ' +
          'with `revealed: false` is not a state that exists. An entity the ' +
          'players cannot see yet is `visible: false`.',
        received: change,
      });
      continue;
    }

    const entity: {
      visible: boolean;
      revealed: boolean;
      status: EntityStatus;
      npcState?: string;
    } = {
      visible: change.visible,
      revealed: change.revealed,
      status: change.status ?? 'unknown',
    };
    if (change.npcState !== undefined) entity.npcState = change.npcState;

    result.applied.entities[entityId] = entity;
    created.push(entityId);
  }

  return created;
}

/**
 * Validates and merges one entity change.
 *
 * **Every invalid field on the entry is reported, and none of them are
 * applied.** The two halves are independent and both deliberate.
 *
 * *All-or-nothing within the entry* is inherited from `ADR-0038 § D4` rather
 * than chosen here: a non-empty `rejections` array makes `SessionService`
 * discard the whole `applied` set and run a correction round, so applying the
 * valid fields of a rejected entry would be unreachable code. The local
 * accumulator is not a step toward partial application.
 *
 * *Reporting every field* is the part that changed. This function used to
 * return at the first bad field, so a Warden told about `status`, fixing it,
 * and failing on an unreported sibling got no second correction — the
 * correction path is single-shot and the turn is thrown. With one rejectable
 * field that was theoretical; it stops being theoretical as soon as the entry
 * carries more than one.
 */
function applyEntity(
  entityId: string,
  change: {
    visible?: boolean;
    revealed?: boolean;
    status?: string;
    npcState?: string;
  },
  currentData: MothershipCampaignState,
  result: ValidationResult,
): void {
  const rejections: ValidationRejection[] = [];

  let proposedStatus: EntityStatus | undefined;
  if (change.status !== undefined) {
    const parsed = EntityStatusSchema.safeParse(change.status);
    if (parsed.success) {
      proposedStatus = parsed.data;
    } else {
      rejections.push({
        path: `entities.${entityId}`,
        reason:
          "status must be 'alive', 'dead', or 'unknown' — it records whether " +
          'an entity is living, not what it is doing. Tactical and narrative ' +
          'detail goes in `npcState`, which takes free text.',
        received: change,
      });
    }
  }

  // An entity created earlier in this same payload is a legitimate target.
  const existing =
    currentData.entities[entityId] ?? result.applied.entities[entityId];

  if (!existing) {
    // Joins the accumulator rather than returning directly, so a change that
    // is both misaddressed *and* carries a bad field reports both. The single
    // correction shot is the reason that matters.
    rejections.push({
      path: `entities.${entityId}`,
      reason:
        `no entity with id "${entityId}" is in play. ` +
        '`entities` updates an entity that already exists; introducing one ' +
        'during play is `newEntities`, which takes `visible` and `revealed`. ' +
        'If this id was meant to name an existing entity, check its spelling ' +
        'against the entity list in the state snapshot.',
      received: change,
    });
    result.rejections.push(...rejections);
    return;
  }

  // **`revealed` is monotonic** (`ADR-0101`): discovery does not un-happen. A
  // gate that can be reopened is not a gate, and enforcing it here rather than
  // by convention is three lines.
  if (change.revealed === false && existing.revealed) {
    rejections.push({
      path: `entities.${entityId}`,
      reason:
        '`revealed` is monotonic — once the players have discovered an ' +
        'entity it cannot become undiscovered. To take an entity out of ' +
        'sight, set `visible: false` and leave `revealed` alone.',
      received: change,
    });
  }

  if (rejections.length > 0) {
    result.rejections.push(...rejections);
    return;
  }

  const merged: {
    visible: boolean;
    revealed: boolean;
    status: EntityStatus;
    npcState?: string;
  } = {
    visible: change.visible ?? existing.visible,
    revealed: change.revealed ?? existing.revealed,
    status: proposedStatus ?? existing.status,
  };

  // Disposition: what this NPC is currently doing or feeling. Writable from
  // this turn (`ADR-0101`) — it was schema-defined, commented and preserved on
  // merge since M7.6 with nothing able to set it, which is why narrative
  // detail kept arriving in `status` instead.
  const nextNpcState = change.npcState ?? existing.npcState;
  if (nextNpcState !== undefined) {
    merged.npcState = nextNpcState;
  }
  result.applied.entities[entityId] = merged;
}

function applyFlag(
  flagName: string,
  change: { value: boolean } | { value: boolean; trigger: string },
  currentData: MothershipCampaignState,
  result: ValidationResult,
): void {
  const existing = currentData.flags[flagName];
  const providedTrigger = 'trigger' in change ? change.trigger : undefined;

  if (!existing) {
    if (providedTrigger === undefined) {
      result.rejections.push({
        path: `flags.${flagName}`,
        reason: 'New flag requires a trigger string.',
        received: change,
      });
      return;
    }
    result.applied.flags[flagName] = {
      value: change.value,
      trigger: providedTrigger,
    };
    return;
  }

  result.applied.flags[flagName] = {
    value: change.value,
    trigger: existing.trigger,
  };
}

function applyScenarioState(
  key: string,
  change: { current: number },
  currentData: MothershipCampaignState,
  result: ValidationResult,
): void {
  const existing = currentData.scenarioState[key];
  if (!existing) {
    result.rejections.push({
      path: `scenarioState.${key}`,
      reason:
        'Scenario state key does not exist — these are defined at synthesis time and cannot be introduced during play.',
      received: change,
    });
    return;
  }
  result.applied.scenarioState[key] = {
    current: change.current,
    max: existing.max,
    note: existing.note,
  };
}
