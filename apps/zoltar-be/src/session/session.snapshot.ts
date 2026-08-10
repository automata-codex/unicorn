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

function renderResourcePools(
  resourcePools: CampaignStateData['resourcePools'],
): string | null {
  const keys = Object.keys(resourcePools).sort();
  if (keys.length === 0) return null;

  const lines = keys.map((key) => {
    const { current, max } = resourcePools[key];
    return max === null ? `${key}: ${current}` : `${key}: ${current}/${max}`;
  });

  return `<resource_pools>\n${lines.join('\n')}\n</resource_pools>`;
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
