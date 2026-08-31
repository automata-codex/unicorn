import type {
  MothershipCharacterSheet,
  MothershipOracleSelections,
  OracleEntry,
  ResourcePool,
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

/** The player's own pools, i.e. `campaign_state.data.resourcePools[entityId]`. */
export type PlayerPools = Record<string, ResourcePool>;

const STAT_LABELS: ReadonlyArray<[string, string]> = [
  ['strength', 'STR'],
  ['speed', 'SPD'],
  ['intellect', 'INT'],
  ['combat', 'CMB'],
];

const SAVE_LABELS: ReadonlyArray<[string, string]> = [
  ['sanity', 'Sanity'],
  ['fear', 'Fear'],
  ['body', 'Body'],
];

/**
 * Renders the character for the synthesis prompt.
 *
 * **Current values come from pools, never from `creationRolls`.** The rolls
 * record what the dice showed at creation and nothing can change them; the
 * pools carry what the character is now. Rendering the rolls would hand the
 * synthesizer a target number that was already wrong the first time a Wound
 * reduced a Stat — silently, because it would still look plausible.
 *
 * Two defects from the pre-M7.6 version are gone with the fields that carried
 * them: it rendered `INST` for Instinct, which is a Contractor stat and does
 * not exist on player characters (PSG §40.1), and it labelled `maxStress`
 * "Stress Threshold", the only use of that name anywhere in the codebase.
 */
export function formatMothershipCharacterProse(
  sheet: MothershipCharacterSheet,
  pools: PlayerPools = {},
): string {
  const value = (name: string): string => {
    const pool = pools[name];
    if (!pool) return '—';
    return pool.max !== null && pool.max !== pool.current
      ? `${pool.current}/${pool.max}`
      : `${pool.current}`;
  };

  const lines = [
    `${sheet.name} (${sheet.class})`,
    // The canonical entity id, not a display name. Without it the model has
    // only `name` to work from and invents an id to build pool names out of —
    // "Lt. Alvarez" derives equally well to `lt_alvarez` or `alvarez`, and the
    // captured M7.5 adventure ended up carrying both for one character. See
    // `docs/decisions.md § Player resource pools are derived at character
    // creation, not at synthesis`.
    `Entity ID: ${sheet.entityId}`,
    `Stats: ${STAT_LABELS.map(([k, l]) => `${l} ${value(k)}`).join(', ')}`,
    `Saves: ${SAVE_LABELS.map(([k, l]) => `${l} ${value(k)}`).join(', ')}`,
    `Health: ${value('hp')}   Wounds: ${value('wounds')}   Stress: ${value('stress')}`,
  ];

  if (sheet.traumaResponse) {
    lines.push(`Trauma Response: ${sheet.traumaResponse}`);
  }
  if (sheet.trinket) lines.push(`Trinket: ${sheet.trinket}`);
  if (sheet.patch) lines.push(`Patch: ${sheet.patch}`);
  if (sheet.notes) lines.push(`Notes: ${sheet.notes}`);

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

/**
 * The synthesis user prompt.
 *
 * **Per-field guidance does not live here. It lives on the field, as a
 * `.describe` in `synthesis.schema.ts`** (`ADR-0118`). This prompt keeps four
 * kinds of thing and nothing else: rendered input (the character, the oracle
 * entries), instructions about the synthesis task rather than about a value,
 * the caller's addendum, and the rules Zod cannot express.
 *
 * Three of those last are here on that test, and each is here for a reason a
 * `.describe` could not serve:
 *
 * - **`adventure_complete`** is a required *key* inside a `z.record`. Saying so
 *   in Zod means changing the type; the service enforces it at
 *   `synthesis.service.ts` instead.
 * - **NEVER INVENT AN NPC TO FILL A ROLE** constrains the entity *list*, not
 *   the `crewRole` field. A description on the field is read while writing one
 *   entity, which is exactly the wrong moment to be told not to add another.
 * - **A spatial-layout entry is required** is a constraint on `worldFacts` as a
 *   whole, and no per-key description can state it. Its *form* — the indexed
 *   list, the top-down deck numbering, the worked examples (`ADR-0117`) — is
 *   per-field and did move onto `worldFacts`.
 *
 * Adding a section that explains one field is the drift this structure exists
 * to prevent: two homes for one kind of thing is how `npcAgendas`,
 * `hiddenTruth` and `oracleConnections` went undescribed in both.
 */
export function buildMothershipSynthesisPrompt(
  characterSheet: MothershipCharacterSheet,
  selections: MothershipOracleSelections,
  addendum?: string,
  playerPools: PlayerPools = {},
): string {
  const sections = [
    `You are synthesizing a GM context for a solo Mothership adventure.`,
    `CHARACTER:\n${formatMothershipCharacterProse(characterSheet, playerPools)}`,
    `ORACLE RESULTS:\n${formatAllMothershipOracleEntries(selections)}`,
    `Each oracle entry includes an id, claude_text (the narrative seed), interfaces (hints for how entries connect across categories), and tags. Use the id values as the basis for entity IDs and flag keys in the structured output. Use the interfaces array to wire entries together coherently — condition values indicate which other entries this one connects to. Synthesize a coherent GM context from these elements and call submit_gm_context when complete.`,
    `PLAYER CHARACTER:\nThe player character's canonical entity id is the "Entity ID" value given under CHARACTER above. Use that exact string wherever you refer to the player character — entity ids, resource pool owners, flag keys. Do not derive an identifier from the display name; the name is for narration only.`,
    `REQUIRED FLAG — adventure_complete:\nEvery scenario must include adventure_complete: { value: false, trigger: "..." } where the trigger names the specific end condition for this adventure.`,
    `CREW ROLES:\nNEVER INVENT AN NPC TO FILL A ROLE — the twenty roles are a vocabulary, not a checklist, and a given ship uses a handful of them while the rest simply do not appear. An NPC exists for narrative reasons first and takes whichever role fits.`,
    `REQUIRED WORLD FACT — spatial layout:\nAt least one structured.worldFacts entry must describe the overall spatial layout of the adventure location — the connective tissue that keeps the Warden from contradicting itself about where things are relative to each other. The worldFacts field description gives the form; this is the requirement that one exists.`,
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
