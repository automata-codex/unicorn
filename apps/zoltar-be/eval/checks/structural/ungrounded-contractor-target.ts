import {
  deriveMothershipInstinct,
  resolveMothershipSkills,
} from '@uv/game-systems';

import type { MothershipCrewRole } from '@uv/game-systems';
import type { DiceRollEventPayload } from '../../../src/session/session.events';
import type { EvalFixture } from '../../fixture.schema';
import type { TurnExecutionResult } from '../../turn-result';
import type { StructuralVerdict } from './types';

type GameEventRow = TurnExecutionResult['gameEvents'][number];

/**
 * The entity fields this check reads. Deliberately a local structural type
 * rather than `EntitySchema`: the source is `fixture.seededState`, which is
 * literal JSON captured at authoring time and validated loosely on purpose
 * (`eval/fixture.schema.ts`), so a fixture frozen before a schema field
 * existed must stay readable rather than throwing at parse.
 */
interface SeededEntity {
  crewRole?: MothershipCrewRole;
  instinctRoll?: number[];
}

export interface ContractorRoll {
  event: GameEventRow;
  entityId: string;
  entity: SeededEntity;
}

/**
 * Entities as the Warden saw them **going into** this turn.
 *
 * Read from `fixture.seededState`, not from `result.campaignState`, for two
 * reasons that happen to agree. The check grades the target the Warden chose,
 * and the Warden chose it from the state it was shown — the turn's own writes
 * land after. And `ADR-0105`'s corollary: data rendered from `seededState`
 * falls under `corpusVersion` because the fixture file is hashed, while data
 * the renderer constructs falls under nothing.
 */
function seededEntities(fixture: EvalFixture): Record<string, SeededEntity> {
  const state = fixture.seededState.campaignState as {
    entities?: unknown;
  };
  const entities = state.entities;
  if (typeof entities !== 'object' || entities === null) return {};
  return entities as Record<string, SeededEntity>;
}

/**
 * The rolls this check grades: a `dice_roll` whose `actingEntityId` names a
 * seeded entity carrying a `crewRole`.
 *
 * Entirely structural — an id lookup against seeded state, no prose. The
 * semantic residual (does the check fall inside a mapped skill's domain)
 * is the rubric's, which is the split `decisions.md § A structural check may
 * read event and state structure; it may not classify prose` requires and
 * `unauditable-mapping.ts` already models.
 *
 * A player entity is excluded for free: `crewRole` is an NPC field, and a
 * player's skills are stored on `characterState` rather than derived.
 */
export function contractorRollsInScope(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): ContractorRoll[] {
  const entities = seededEntities(fixture);
  const rolls: ContractorRoll[] = [];

  for (const event of result.gameEvents) {
    if (event.eventType !== 'dice_roll') continue;
    const { actingEntityId } = event.payload as DiceRollEventPayload;
    if (typeof actingEntityId !== 'string' || actingEntityId.length === 0) {
      continue;
    }
    const entity = entities[actingEntityId];
    if (!entity?.crewRole) continue;
    rolls.push({ event, entityId: actingEntityId, entity });
  }

  return rolls;
}

/** Rolls carrying no `actingEntityId` at all — the classifier's blind spot. */
function unattributedRolls(result: TurnExecutionResult): GameEventRow[] {
  return result.gameEvents.filter((event) => {
    if (event.eventType !== 'dice_roll') return false;
    const { actingEntityId } = event.payload as DiceRollEventPayload;
    return typeof actingEntityId !== 'string' || actingEntityId.length === 0;
  });
}

/**
 * UNGROUNDED-CONTRACTOR-TARGET's structural pre-filter. Decides *whether a
 * Contractor rolled at all*; whether the target it rolled against was the
 * right one goes to the rubric.
 *
 * **Three exclusion reasons, not one, and the third is the blind-spot
 * signal.** `unauditable-mapping.ts` records why this split is the
 * deliverable rather than a nicety: "the turn rolled nothing" is a fact about
 * the Warden, while "the turn rolled and this classifier saw nothing" is a
 * fact about the classifier. Here the second splits again, because
 * `actingEntityId` is optional on the payload. A turn whose rolls are simply
 * not attributed may well contain a Contractor's check that this gate cannot
 * see, and that is a different situation from a turn where every roll is
 * attributed and none is a Contractor's. If the unattributed count climbs,
 * the attribution is what needs fixing, not this rate.
 *
 * Every `actualCode` is a fixed string — no counts interpolated — so
 * `summarizeExclusions` collects each branch into one row whose size is the
 * signal, rather than splintering by how many rolls a rep happened to make.
 */
export function ungroundedContractorTargetGate(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): StructuralVerdict | null {
  const diceRolls = result.gameEvents.filter(
    (e) => e.eventType === 'dice_roll',
  );

  if (diceRolls.length === 0) {
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        'no dice_roll events this turn — no Contractor resolved a check, so there is ' +
        'no target to compare against a derived one',
      actualCode: 'no dice_roll events this turn',
    };
  }

  const inScope = contractorRollsInScope(result, fixture);
  if (inScope.length === 0) {
    const unattributed = unattributedRolls(result);
    if (unattributed.length > 0) {
      return {
        outcome: 'NOT_APPLICABLE',
        actual:
          `${diceRolls.length} dice_roll event(s) this turn, none attributed to a ` +
          `crewRole-bearing entity, and ${unattributed.length} carrying no ` +
          'actingEntityId at all — a Contractor check may have happened here and be ' +
          'invisible to this gate. If this count grows, attribution is what needs ' +
          'fixing, not this rate',
        actualCode:
          'dice_roll events present, none attributed to a crewRole-bearing entity, ' +
          'some unattributed',
      };
    }
    return {
      outcome: 'NOT_APPLICABLE',
      actual:
        `${diceRolls.length} dice_roll event(s) this turn, every one attributed, none ` +
        'to an entity carrying a crewRole — no Contractor acted, which is an honest ' +
        'exclusion rather than a gap in this classifier',
      actualCode:
        'dice_roll events present, all attributed, none to a crewRole-bearing entity',
    };
  }

  return null;
}

/**
 * The in-scope rolls and the arithmetic behind each, rendered for the judge.
 *
 * **The derivation is computed here, never described in the rubric.** A
 * Contractor's Instinct and skill chain are derived at read time and stored
 * nowhere (`ADR-0100`: `crewRole` is the input, the chain is arithmetic over
 * it). So the judge cannot look them up — they must either be handed over by
 * code or restated as a 20-row table in prose for the model to re-apply. The
 * second is a second implementation of `CREW_ROLE_SKILLS`, free to drift from
 * the first the moment anyone edits the table, in a check whose entire
 * subject is whether the Warden's target followed from that table.
 * `judgeContext`'s own
 * doc comment names this: one implementation selects, the judge grades what
 * it hands over.
 *
 * Every target the judge could need is therefore precomputed. That leaves the
 * judge two questions rather than one, and only the first is semantic: which
 * of the supplied numbers this roll should have used, and — needing no
 * judgment at all — whether the stated target is any of them. The second is
 * the violation that would be structural if a GM-side roll carried a `target`
 * field, and the one a rubric enumerating only skill mistakes would miss.
 */
export function ungroundedContractorTargetJudgeContext(
  result: TurnExecutionResult,
  fixture: EvalFixture,
): string {
  const blocks = contractorRollsInScope(result, fixture).map(
    ({ event, entityId, entity }) => {
      const payload = event.payload as DiceRollEventPayload;
      const instinct = deriveMothershipInstinct(entity);
      const skills = resolveMothershipSkills({ entity });

      const lines = [
        `- sequence ${event.sequenceNumber}: notation "${payload.notation}", ` +
          `result ${JSON.stringify(payload.results ?? [])}, ` +
          `purpose "${payload.purpose ?? ''}"`,
        `    acting entity: ${entityId} (crewRole ${entity.crewRole})`,
      ];

      // `null` where the entity carries no `instinctRoll` — an NPC authored
      // before the field existed. The role still maps to a chain, so the
      // skills below are real, but no absolute target can be stated and the
      // judge is told so rather than shown a fabricated number.
      if (instinct === null) {
        lines.push(
          '    Instinct: not derivable — this entity carries no instinctRoll, so ' +
            'no target can be stated. Grade only whether a skill bonus was applied ' +
            'that the roll does not warrant.',
        );
      } else {
        lines.push(`    target if no mapped skill applies: ${instinct}`);
        for (const skill of skills) {
          const note = skill.suppressed
            ? ' — SUPPRESSED by a condition, so it contributes +0'
            : '';
          lines.push(
            `    target if "${skill.skill}" (${skill.tier}, +${skill.bonus}) applies: ` +
              `${instinct + skill.bonus}${note}`,
          );
        }
      }

      if (skills.length === 0) {
        lines.push(
          '    this role maps to no skills, so Instinct alone is the only correct target',
        );
      }

      return lines.join('\n');
    },
  );

  return (
    'The rolls under review this turn — already filtered to rolls whose actingEntityId ' +
    'names an entity carrying a crewRole. Grade only these; ignore every other roll in ' +
    'the sequence above.\n\n' +
    'Each roll is followed by every target it could correctly have used, computed from ' +
    "that entity's own stored dice and role. You do not need to know the role table: " +
    'the numbers below are derived from it directly.\n' +
    blocks.join('\n')
  );
}
