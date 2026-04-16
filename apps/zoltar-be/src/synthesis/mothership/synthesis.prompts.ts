import type {
  MothershipCharacterSheet,
  MothershipOracleSelections,
  OracleEntry,
} from '@uv/game-systems';

export const MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT =
  'You are a GM context synthesizer for a Mothership RPG adventure.';

export const MOTHERSHIP_COHERENCE_SYSTEM_PROMPT =
  'You are checking oracle table selections for a Mothership RPG adventure for hard contradictions.';

/**
 * Canonical ordering of Mothership oracle categories. The service uses this
 * list to validate rerollCategory values coming back from coherence checks.
 */
export const MOTHERSHIP_ORACLE_CATEGORIES = [
  'survivor',
  'threat',
  'secret',
  'vessel_type',
  'tone',
] as const satisfies ReadonlyArray<keyof MothershipOracleSelections>;

export type MothershipOracleCategory =
  (typeof MOTHERSHIP_ORACLE_CATEGORIES)[number];

export function formatMothershipCharacterProse(
  sheet: MothershipCharacterSheet,
): string {
  const lines = [
    `${sheet.name} (${sheet.class})`,
    `Stats: STR ${sheet.stats.strength}, SPD ${sheet.stats.speed}, INT ${sheet.stats.intellect}, CMB ${sheet.stats.combat}, INST ${sheet.stats.instinct}, SAN ${sheet.stats.sanity}`,
    `Saves: Fear ${sheet.saves.fear}, Body ${sheet.saves.body}, Armor ${sheet.saves.armor}/${sheet.saves.armorMax}`,
    `HP: ${sheet.maxHp}   Stress Threshold: ${sheet.maxStress}`,
    `Skills: ${sheet.skills.join(', ') || '(none)'}`,
    `Equipment: ${sheet.equipment.join(', ') || '(none)'}`,
  ];
  return lines.join('\n');
}

export function formatOracleEntry(label: string, entry: OracleEntry): string {
  return `${label}:\n${JSON.stringify(entry, null, 2)}`;
}

function formatAllMothershipOracleEntries(
  selections: MothershipOracleSelections,
): string {
  return [
    formatOracleEntry('Survivor', selections.survivor),
    formatOracleEntry('Threat', selections.threat),
    formatOracleEntry('Secret', selections.secret),
    formatOracleEntry('Vessel Type', selections.vessel_type),
    formatOracleEntry('Tone', selections.tone),
  ].join('\n\n');
}

export function buildMothershipSynthesisPrompt(
  characterSheet: MothershipCharacterSheet,
  selections: MothershipOracleSelections,
  addendum?: string,
): string {
  const sections = [
    `You are synthesizing a GM context for a solo Mothership adventure.`,
    `CHARACTER:\n${formatMothershipCharacterProse(characterSheet)}`,
    `ORACLE RESULTS:\n${formatAllMothershipOracleEntries(selections)}`,
    `Each oracle entry includes an id, claude_text (the narrative seed), interfaces (hints for how entries connect across categories), and tags. Use the id values as the basis for entity IDs and flag keys in the structured output. Use the interfaces array to wire entries together coherently — condition values indicate which other entries this one connects to. Synthesize a coherent GM context from these elements and call submit_gm_context when complete.`,
    `FLAGS:\nEach flag in the structured output must include both a value (boolean) and a trigger (the specific in-fiction action or event that flips it). Example: { "distress_beacon_active": { "value": false, "trigger": "Flip to true when the player or an NPC activates the beacon at the bridge console. Approaching the console is not sufficient." } }`,
    `REQUIRED FLAG — adventure_complete:\nEvery scenario must include adventure_complete: { value: false, trigger: "..." } where the trigger names the specific end condition for this adventure.`,
    `COUNTDOWN TIMERS:\nAny mechanic that involves a number counting down over the course of the adventure must be initialized as a named resource pool in initialState. Use the naming convention {entity_id}_timer — e.g. crewman_wick_timer: { current: 4, max: 4 }. Do not track countdowns as freeform state or narrative-only values.`,
    `WORLD FACTS:\nUse structured.worldFacts for any non-numeric initial state the Warden needs to remember across turns. Keys should be descriptive snake_case. Values are plain strings. Do not put numeric state here — use initialState for resource pools and countdown timers.\n\nSpatial layout (required): At least one worldFacts entry must describe the overall spatial layout of the adventure location — the connective tissue the Warden needs to avoid contradicting itself about where things are relative to each other. The entry or entries should capture: the overall shape of the space (a single ship, a station with multiple modules, a planet-side installation), named areas or rooms that matter to the scenario and how they connect, and notable spatial features like chokepoints, hazards, landmarks, or barriers. This is not a room-by-room prose description, not an inventory of items, and not entity placements (those live in structured.entities). It is the Warden's mental map of the location.\n\nFor a simple scenario (one ship, a handful of compartments), use a single entry keyed descriptively. For a complex scenario (multi-module station, multi-level structure), split into multiple entries along whatever axis makes sense for the fiction — per deck, per module, per zone. Choose the split based on the scenario's natural structure; there is no required template.\n\nExamples:\n- ship_layout: "Three decks connected by a central ladder shaft. Upper deck: bridge, comms array, captain's quarters. Mid deck: crew berths, mess hall, medbay. Lower deck: cargo bay, engine room, airlock. The only path between upper and lower deck passes through the mid deck corridor."\n- station_core: "Toroidal hub with four radial spokes. Spoke A leads to docking, Spoke B to hydroponics, Spoke C to command, Spoke D is sealed — hull breach. The hub ring is pressurized but unlit."\n\nOther uses: environmental detail that must stay consistent (specific graffiti text, console readout content), NPC cover identities, starting deck or location name, and any other non-numeric fact the Warden must remember across turns.`,
    `OPENING NARRATION:\nWrite an openingNarration — the ambient scene at the moment the player character enters the adventure, before any player agency. Establish the immediate physical situation, convey the atmosphere, and include one concrete detail the player did not put there — something that signals the world has already been in motion without them.`,
  ];

  if (addendum?.trim()) {
    sections.push(`ADDITIONAL DIRECTION:\n${addendum.trim()}`);
  }

  return sections.join('\n\n');
}

export function buildMothershipCoherenceCheckPrompt(
  selections: MothershipOracleSelections,
): string {
  return [
    'Check the following oracle selections for a Mothership adventure for hard contradictions — combinations the adventure cannot narratively support without rewriting the seed content.',
    `SELECTIONS:\n${formatAllMothershipOracleEntries(selections)}`,
    'Use the interfaces arrays to understand how entries are meant to connect. Only flag conflicts that cannot be resolved through ordinary narrative synthesis. Call report_coherence with your findings.',
    'Resolution guide: "proceed" if the selections are coherent or the tension is resolvable through narrative means; "reroll" if one specific category could be swapped to resolve the conflict (set rerollCategory); "surface" if the conflict is unresolvable and the player must adjust their filters.',
  ].join('\n\n');
}
