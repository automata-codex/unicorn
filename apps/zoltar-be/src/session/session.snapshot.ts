import {
  emptyMothershipCharacterState,
  resolveMothershipSkills,
} from '@uv/game-systems';

import type { MothershipCampaignState } from '@uv/game-systems';

/**
 * Shape of the `gm_context.blob` payload as the session module reads it. The
 * fields match what `buildGmContextBlob` writes at synthesis time plus
 * `playerEntityIds`, which Phase 5 supplies from a character-sheet lookup.
 *
 * `structured.flags` is the set of flags present at synthesis time. The
 * snapshot re-emits each flag's current value every turn, but only re-emits
 * the trigger for flags NOT in this set — i.e., flags introduced during play.
 * Original flags' triggers sit inside the cached GM context blob, so
 * re-emitting them in the per-turn snapshot is waste.
 *
 * `playerEntityIds` lists the player-character entity identifiers, sourced from
 * `character_sheet.data.entityId`. Player entities are always emitted in
 * `<entities>` — including ones absent from `campaign_state.data.entities`,
 * which in practice is all of them, since that map holds NPCs, threats and
 * features only. Hidden NPC/threat/feature entities remain elided.
 */
export interface GmContextBlob {
  openingNarration?: string | null;
  narrative?: {
    location: string;
    atmosphere: string;
    npcAgendas: Record<string, string>;
    hiddenTruth: string;
    oracleConnections: string;
  };
  entities?: Array<{
    id: string;
    type: 'npc' | 'threat' | 'feature';
    visible: boolean;
    tags: string[];
  }>;
  structured?: {
    flags?: Record<string, { value: boolean; trigger: string }>;
  };
  playerEntityIds?: readonly string[];
}

export type CampaignStateData = MothershipCampaignState;

export function buildStateSnapshot(input: {
  gmContextBlob: GmContextBlob;
  campaignStateData: CampaignStateData;
}): string {
  const { gmContextBlob, campaignStateData } = input;

  const sections: string[] = [];

  const pools = renderResourcePools(campaignStateData.resourcePools);
  if (pools !== null) sections.push(pools);

  const attributes = renderCharacterAttributes(
    campaignStateData.characterState ?? {},
  );
  if (attributes !== null) sections.push(attributes);

  const entities = renderEntities(
    campaignStateData.entities,
    new Set(gmContextBlob.playerEntityIds ?? []),
  );
  if (entities !== null) sections.push(entities);

  const flags = renderFlags(
    campaignStateData.flags,
    gmContextBlob.structured?.flags,
  );
  if (flags !== null) sections.push(flags);

  const scenarioState = renderScenarioState(campaignStateData.scenarioState);
  if (scenarioState !== null) sections.push(scenarioState);

  const worldFacts = renderWorldFacts(campaignStateData.worldFacts);
  if (worldFacts !== null) sections.push(worldFacts);

  if (sections.length === 0) {
    return '<state_snapshot>\n</state_snapshot>';
  }

  return `<state_snapshot>\n\n${sections.join('\n\n')}\n\n</state_snapshot>`;
}

/**
 * Renders `<resource_pools>` from the two-level `resourcePools[owner][pool]`
 * map, one line per pool, addressed owner-first as `alvarez.hp: 18/20`.
 *
 * The rendered address is deliberately the same string the tool payload keys
 * pool changes by. A flat list rather than an owner-grouped block for the same
 * reason: the Warden writes one address per change, and a grouped block would
 * make it reassemble the address from a heading it might be several lines away
 * from. Owners sort together anyway, so grouping buys nothing but a chance to
 * get the join wrong.
 *
 * Owners with no pools render nothing rather than an empty heading — that state
 * is reachable after `CharacterService.delete` removes an owner's pools.
 */
function renderResourcePools(
  resourcePools: CampaignStateData['resourcePools'],
): string | null {
  const lines: string[] = [];

  for (const owner of Object.keys(resourcePools).sort()) {
    const pools = resourcePools[owner];
    for (const poolName of Object.keys(pools).sort()) {
      const { current, max } = pools[poolName];
      const value = max === null ? `${current}` : `${current}/${max}`;
      lines.push(`${owner}.${poolName}: ${value}`);
    }
  }

  if (lines.length === 0) return null;

  return `<resource_pools>\n${lines.join('\n')}\n</resource_pools>`;
}

/**
 * Renders `<character_attributes>` — the block specified in the design doc and
 * the M5 spec, and deferred ever since for want of a data source
 * (`decisions.md § The <character_attributes> snapshot block is specified but
 * deferred until a data source exists`). M7.6 Parts 1–3 create it.
 *
 * Three fields per §4.2: **armor mode** (worn item, current AP, destroyed
 * flag, O2 remaining), **weapon loadout** (readied weapon and shots
 * remaining), and **active conditions** with their parameters.
 *
 * **Current values only, never creation rolls.** The roadmap bullet this
 * closes calls it a "static build data" render and its own title is wrong:
 * Wounds reduce a Stat and a Save, Level 2 radiation reduces all seven per
 * round, Stress overflow reduces the most relevant one. A render built on the
 * static assumption hands the Warden a stale target number after any wound —
 * silently, because the number still looks plausible. Stats and Saves are
 * therefore in `<resource_pools>`, which is live, and nothing is duplicated
 * here.
 *
 * An entity with nothing to say is omitted rather than rendered as an empty
 * heading, and an empty block is suppressed entirely — consistent with the
 * other five renders.
 */
function renderCharacterAttributes(
  characterState: CampaignStateData['characterState'],
): string | null {
  const blocks: string[] = [];

  for (const entityId of Object.keys(characterState).sort()) {
    /*
     * Backfilled against the empty state, not read raw. `campaign_state.data`
     * is JSONB and is read without re-parsing through the schema, so Zod's
     * `.default([])` never runs for a row written before a field existed —
     * a character created before `rollModifiers` was added has no such key,
     * and `.length` on it takes down the whole turn. Merging with the empty
     * state makes every field present for this render and for every field
     * added after it.
     */
    const state = {
      ...emptyMothershipCharacterState(),
      ...characterState[entityId],
    };
    const lines: string[] = [];

    const armor = state.wornArmor;
    if (armor) {
      const bits = [
        armor.destroyed ? `${armor.item} (DESTROYED)` : armor.item,
        `AP ${armor.apCurrent}/${armor.apBase}`,
      ];
      // DR is stated even at zero: it applies first and survives both armor
      // destruction and Anti-Armor, and a Warden that does not see it will
      // subtract nothing once the armor is gone.
      bits.push(`DR ${armor.dr}`);
      if (armor.o2Remaining !== null) {
        bits.push(`O2 ${armor.o2Remaining} min`);
      }
      if (armor.features.length > 0) {
        bits.push(armor.features.join(', '));
      }
      lines.push(`  armor: ${bits.join(' — ')}`);
    }

    // Weapon loadout: the equipment entries that track a count. An item with
    // neither a quantity nor charges is inert kit and says nothing the Warden
    // needs mid-turn.
    const loadout = state.equipment.filter(
      (item) => item.quantity !== undefined || item.charges !== undefined,
    );
    if (loadout.length > 0) {
      const rendered = loadout.map((item) => {
        const counts: string[] = [];
        if (item.charges !== undefined) counts.push(`${item.charges} loaded`);
        if (item.quantity !== undefined) counts.push(`x${item.quantity}`);
        return `${item.item} (${counts.join(', ')})`;
      });
      lines.push(`  loadout: ${rendered.join('; ')}`);
    }

    // Skills, with suppression already applied by the shared accessor. A
    // suppressed skill still renders — the training is not lost, the bonus is,
    // and a Warden that sees the skill vanish will read it as never held.
    const skills = resolveMothershipSkills({ characterState: state });
    if (skills.length > 0) {
      const rendered = skills.map((skill) =>
        skill.suppressed
          ? `${skill.skill} ${skill.tier} (suppressed)`
          : `${skill.skill} ${skill.tier} (+${skill.bonus})`,
      );
      lines.push(`  skills: ${rendered.join(', ')}`);
    }

    if (state.conditions.length > 0) {
      const rendered = state.conditions.map((entry) =>
        entry.parameter
          ? `${entry.condition} (${entry.parameter})`
          : entry.condition,
      );
      lines.push(`  conditions: ${rendered.join(', ')}`);
    }

    // Durable Advantage/Disadvantage that is not a Condition — today the
    // Wounds Table's Fatal Injury row. Rendered with its source, because the
    // source is what a removal names and what tells two of the same shape
    // apart.
    if (state.rollModifiers.length > 0) {
      const rendered = state.rollModifiers.map((mod) => {
        const mark = mod.effect === 'advantage' ? '[+]' : '[-]';
        const where =
          mod.scope === 'all_rolls'
            ? 'all rolls'
            : `${mod.scope} ${mod.target}`;
        return `${mark} on ${where} (${mod.source})`;
      });
      lines.push(`  roll modifiers: ${rendered.join('; ')}`);
    }

    // The three that change how a roll resolves, stated only when they are
    // not at their resting value — a line reading "bleeding: 0" every turn
    // teaches the Warden to skip the block.
    if (state.bleeding > 0) {
      lines.push(
        `  bleeding: ${state.bleeding} per round, ignores armor and DR`,
      );
    }
    if (state.minimumStress !== 2) {
      lines.push(`  minimum stress: ${state.minimumStress}`);
    }
    if (state.pendingDeathSave !== null) {
      lines.push(`  death save: in ${state.pendingDeathSave} rounds`);
    }

    if (lines.length > 0) {
      blocks.push(`${entityId}:\n${lines.join('\n')}`);
    }
  }

  if (blocks.length === 0) return null;

  return `<character_attributes>\n${blocks.join('\n')}\n</character_attributes>`;
}

/**
 * Renders `<entities>`, with player characters as a **source** rather than a
 * filter override.
 *
 * The previous implementation only un-hid ids already present in `entities`,
 * and `campaign_state.data.entities` holds NPCs, threats and features only — so
 * the player's id appeared nowhere in the prompt and the Warden inferred one
 * from resource pool names, which is how `actingEntityId` came back
 * unresolvable in the M7.5 capture (`docs/decisions.md § actingEntityId must
 * resolve against a declared identifier set`). Player ids are now emitted
 * whether or not the map carries them, tagged `player_character`, and listed
 * first so the canonical spelling is the first thing the block states.
 *
 * A player id absent from the map reports `status=unknown` — the same value
 * `buildEntityMap` gives every synthesized entity, and the honest one here:
 * nothing recorded a status. Live HP is in `<resource_pools>` regardless.
 */
function renderEntities(
  entities: CampaignStateData['entities'],
  playerEntityIds: ReadonlySet<string>,
): string | null {
  const playerLines = [...playerEntityIds].sort().map((id) => {
    const entity = entities[id];
    if (!entity) return `${id}: visible, status=unknown, player_character`;
    const visibility = entity.visible ? 'visible' : 'hidden';
    return `${id}: ${visibility}, status=${entity.status}, player_character`;
  });

  const otherLines = Object.keys(entities)
    .sort()
    .filter((id) => !playerEntityIds.has(id) && entities[id].visible)
    .map((id) => `${id}: visible, status=${entities[id].status}`);

  const lines = [...playerLines, ...otherLines];
  if (lines.length === 0) return null;

  return `<entities>\n${lines.join('\n')}\n</entities>`;
}

function renderFlags(
  flags: CampaignStateData['flags'],
  originalFlags:
    | Record<string, { value: boolean; trigger: string }>
    | undefined,
): string | null {
  const keys = Object.keys(flags).sort();
  if (keys.length === 0) return null;

  // If the blob doesn't carry an original flag set (e.g. adventures created
  // before buildGmContextBlob started persisting structured.flags), assume
  // every current flag is original — no triggers emitted.
  const originalKeys = new Set(Object.keys(originalFlags ?? flags));

  const lines = keys.map((key) => {
    const flag = flags[key];
    if (originalKeys.has(key)) {
      return `${key}: ${flag.value}`;
    }
    return `${key}: ${flag.value} (trigger: ${flag.trigger})`;
  });

  return `<flags>\n${lines.join('\n')}\n</flags>`;
}

function renderScenarioState(
  scenarioState: CampaignStateData['scenarioState'],
): string | null {
  const keys = Object.keys(scenarioState).sort();
  if (keys.length === 0) return null;

  const lines = keys.map((key) => {
    const { current, max, note } = scenarioState[key];
    const head =
      max === null ? `${key}: ${current}` : `${key}: ${current}/${max}`;
    return note ? `${head} — ${note}` : head;
  });

  return `<scenario_state>\n${lines.join('\n')}\n</scenario_state>`;
}

function renderWorldFacts(
  worldFacts: CampaignStateData['worldFacts'],
): string | null {
  const keys = Object.keys(worldFacts).sort();
  if (keys.length === 0) return null;

  const lines = keys.map((key) => `${key}: ${worldFacts[key]}`);
  return `<world_facts>\n${lines.join('\n')}\n</world_facts>`;
}
