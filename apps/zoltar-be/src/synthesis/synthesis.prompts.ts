import type Anthropic from '@anthropic-ai/sdk';
import type {
  MothershipCharacterSheet,
  MothershipOracleSelections,
  OracleEntry,
} from '@uv/game-systems';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { submitGmContextSchema } from './synthesis.schema';

export const SYNTHESIS_SYSTEM_PROMPT =
  'You are a GM context synthesizer for a Mothership RPG adventure.';

export const COHERENCE_SYSTEM_PROMPT =
  'You are checking oracle table selections for a Mothership RPG adventure for hard contradictions.';

export function formatCharacterProse(sheet: MothershipCharacterSheet): string {
  const lines = [
    `${sheet.name} (${sheet.class})`,
    `Stats: STR ${sheet.stats.strength}, SPD ${sheet.stats.speed}, INT ${sheet.stats.intellect}, CMB ${sheet.stats.combat}, INST ${sheet.stats.instinct}, SAN ${sheet.stats.sanity}`,
    `Saves: Fear ${sheet.saves.fear}, Body ${sheet.saves.body}, Armor ${sheet.saves.armor}/${sheet.saves.armorMax}`,
    `HP: ${sheet.currentHp}/${sheet.maxHp}   Stress: ${sheet.stress.current}/${sheet.stress.max}`,
    `Skills: ${sheet.skills.join(', ') || '(none)'}`,
    `Equipment: ${sheet.equipment.join(', ') || '(none)'}`,
  ];
  return lines.join('\n');
}

export function formatOracleEntry(label: string, entry: OracleEntry): string {
  return `${label}:\n${JSON.stringify(entry, null, 2)}`;
}

export function buildMothershipSynthesisPrompt(
  characterSheet: MothershipCharacterSheet,
  selections: MothershipOracleSelections,
  addendum?: string,
): string {
  const sections = [
    `You are synthesizing a GM context for a solo Mothership adventure.`,
    `CHARACTER:\n${formatCharacterProse(characterSheet)}`,
    `ORACLE RESULTS:\n${[
      formatOracleEntry('Survivor', selections.survivor),
      formatOracleEntry('Threat', selections.threat),
      formatOracleEntry('Secret', selections.secret),
      formatOracleEntry('Vessel Type', selections.vessel_type),
      formatOracleEntry('Tone', selections.tone),
    ].join('\n\n')}`,
    `Each oracle entry includes an id, claude_text (the narrative seed), interfaces (hints for how entries connect across categories), and tags. Use the id values as the basis for entity IDs and flag keys in the structured output. Use the interfaces array to wire entries together coherently — condition values indicate which other entries this one connects to. Synthesize a coherent GM context from these elements and call submit_gm_context when complete.`,
    `FLAGS:\nEach flag in the structured output must include both a value (boolean) and a trigger (the specific in-fiction action or event that flips it). Example: { "distress_beacon_active": { "value": false, "trigger": "Flip to true when the player or an NPC activates the beacon at the bridge console. Approaching the console is not sufficient." } }`,
    `REQUIRED FLAG — adventure_complete:\nEvery scenario must include adventure_complete: { value: false, trigger: "..." } where the trigger names the specific end condition for this adventure.`,
    `COUNTDOWN TIMERS:\nAny mechanic that involves a number counting down over the course of the adventure must be initialized as a named resource pool in initialState. Use the naming convention {entity_id}_timer — e.g. crewman_wick_timer: { current: 4, max: 4 }. Do not track countdowns as freeform state or narrative-only values.`,
    `OPENING NARRATION:\nWrite an openingNarration — the ambient scene at the moment the player character enters the adventure, before any player agency. Establish the immediate physical situation, convey the atmosphere, and include one concrete detail the player did not put there — something that signals the world has already been in motion without them.`,
  ];

  if (addendum?.trim()) {
    sections.push(`ADDITIONAL DIRECTION:\n${addendum.trim()}`);
  }

  return sections.join('\n\n');
}

const submitGmContextJsonSchema = zodToJsonSchema(submitGmContextSchema, {
  $refStrategy: 'none',
});

export const SUBMIT_GM_CONTEXT_TOOL: Anthropic.Tool = {
  name: 'submit_gm_context',
  description:
    'Commit the synthesized GM context to the database. Call this exactly once when synthesis is complete.',
  input_schema: submitGmContextJsonSchema as Anthropic.Tool['input_schema'],
};

export const SYNTHESIS_TOOLS: Anthropic.Tool[] = [SUBMIT_GM_CONTEXT_TOOL];

export const REPORT_COHERENCE_TOOL: Anthropic.Tool = {
  name: 'report_coherence',
  description:
    'Report hard contradictions between oracle selections, if any, and a recommended resolution path.',
  input_schema: {
    type: 'object',
    properties: {
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            description: { type: 'string' },
            rerollable: { type: 'boolean' },
          },
          required: ['category', 'description', 'rerollable'],
        },
      },
      resolution: {
        type: 'string',
        enum: ['proceed', 'reroll', 'surface'],
      },
      rerollCategory: { type: 'string' },
    },
    required: ['conflicts', 'resolution'],
  },
};

export const COHERENCE_TOOLS: Anthropic.Tool[] = [REPORT_COHERENCE_TOOL];

export function buildCoherenceCheckPrompt(
  selections: MothershipOracleSelections,
): string {
  return [
    'Check the following oracle selections for a Mothership adventure for hard contradictions — combinations the adventure cannot narratively support without rewriting the seed content.',
    `SELECTIONS:\n${[
      formatOracleEntry('Survivor', selections.survivor),
      formatOracleEntry('Threat', selections.threat),
      formatOracleEntry('Secret', selections.secret),
      formatOracleEntry('Vessel Type', selections.vessel_type),
      formatOracleEntry('Tone', selections.tone),
    ].join('\n\n')}`,
    'Use the interfaces arrays to understand how entries are meant to connect. Only flag conflicts that cannot be resolved through ordinary narrative synthesis. Call report_coherence with your findings.',
    'Resolution guide: "proceed" if the selections are coherent or the tension is resolvable through narrative means; "reroll" if one specific category could be swapped to resolve the conflict (set rerollCategory); "surface" if the conflict is unresolvable and the player must adjust their filters.',
  ].join('\n\n');
}
