import { describe, expect, it } from 'vitest';

import { baseSelections, vasquezSheet } from '../synthesis.fixtures';
import {
  COHERENCE_TOOLS,
  REPORT_COHERENCE_TOOL,
  SUBMIT_GM_CONTEXT_TOOL,
  SYNTHESIS_TOOLS,
} from '../synthesis.tools';

import {
  buildMothershipCoherenceCheckPrompt,
  buildMothershipSynthesisPrompt,
  formatMothershipCharacterProse,
  formatOracleEntry,
  MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT,
} from './synthesis.prompts';

describe('formatMothershipCharacterProse', () => {
  it('renders name, class, stats, saves, HP, stress, skills, equipment', () => {
    const prose = formatMothershipCharacterProse(vasquezSheet);
    expect(prose).toContain('Vasquez (marine)');
    expect(prose).toContain('STR 55');
    expect(prose).toContain('SAN 50');
    expect(prose).toContain('Fear 30');
    expect(prose).toContain('Armor 10/20');
    expect(prose).toContain('HP: 15');
    expect(prose).toContain('Stress Threshold: 20');
    expect(prose).toContain('Military Training, Firearms');
    expect(prose).toContain('Combat Armor, Pulse Rifle');
  });

  it('renders "(none)" when skills or equipment are empty', () => {
    const prose = formatMothershipCharacterProse({
      ...vasquezSheet,
      skills: [],
      equipment: [],
    });
    expect(prose).toContain('Skills: (none)');
    expect(prose).toContain('Equipment: (none)');
  });
});

describe('formatOracleEntry', () => {
  it('serializes the entry as labeled JSON', () => {
    const out = formatOracleEntry('Survivor', baseSelections.survivor);
    expect(out.startsWith('Survivor:\n')).toBe(true);
    const parsed = JSON.parse(out.replace('Survivor:\n', ''));
    expect(parsed.id).toBe('survivor_1');
  });
});

describe('buildMothershipSynthesisPrompt', () => {
  it('includes every required section', () => {
    const prompt = buildMothershipSynthesisPrompt(
      vasquezSheet,
      baseSelections,
    );
    expect(prompt).toContain('CHARACTER:');
    expect(prompt).toContain('ORACLE RESULTS:');
    expect(prompt).toContain('Survivor:');
    expect(prompt).toContain('Threat:');
    expect(prompt).toContain('Secret:');
    expect(prompt).toContain('Vessel Type:');
    expect(prompt).toContain('Tone:');
    expect(prompt).toContain('FLAGS:');
    expect(prompt).toContain('REQUIRED FLAG — adventure_complete');
    expect(prompt).toContain('COUNTDOWN TIMERS:');
    expect(prompt).toContain('OPENING NARRATION:');
  });

  it('omits the addendum section when not provided', () => {
    const prompt = buildMothershipSynthesisPrompt(
      vasquezSheet,
      baseSelections,
    );
    expect(prompt).not.toContain('ADDITIONAL DIRECTION:');
  });

  it('omits the addendum section when provided but blank', () => {
    const prompt = buildMothershipSynthesisPrompt(
      vasquezSheet,
      baseSelections,
      '   \n  ',
    );
    expect(prompt).not.toContain('ADDITIONAL DIRECTION:');
  });

  it('appends the trimmed addendum when provided', () => {
    const prompt = buildMothershipSynthesisPrompt(
      vasquezSheet,
      baseSelections,
      '  keep it tense  ',
    );
    expect(prompt).toMatch(/ADDITIONAL DIRECTION:\nkeep it tense$/);
  });
});

describe('buildMothershipCoherenceCheckPrompt', () => {
  it('lists all five categories and references the resolution values', () => {
    const prompt = buildMothershipCoherenceCheckPrompt(baseSelections);
    for (const label of ['Survivor', 'Threat', 'Secret', 'Vessel Type', 'Tone']) {
      expect(prompt).toContain(`${label}:`);
    }
    expect(prompt).toContain('proceed');
    expect(prompt).toContain('reroll');
    expect(prompt).toContain('surface');
  });
});

describe('tool definitions', () => {
  it('SYNTHESIS_TOOLS exposes submit_gm_context as an object-typed input schema', () => {
    expect(SYNTHESIS_TOOLS).toHaveLength(1);
    expect(SYNTHESIS_TOOLS[0]).toBe(SUBMIT_GM_CONTEXT_TOOL);
    expect(SUBMIT_GM_CONTEXT_TOOL.name).toBe('submit_gm_context');
    expect(SUBMIT_GM_CONTEXT_TOOL.input_schema.type).toBe('object');
    expect(SUBMIT_GM_CONTEXT_TOOL.input_schema.properties).toBeDefined();
  });

  it('COHERENCE_TOOLS exposes report_coherence with the expected resolution enum', () => {
    expect(COHERENCE_TOOLS).toEqual([REPORT_COHERENCE_TOOL]);
    const props = REPORT_COHERENCE_TOOL.input_schema.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(props.resolution.enum).toEqual(['proceed', 'reroll', 'surface']);
  });
});

describe('MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT', () => {
  it('is the spec-mandated string', () => {
    expect(MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT).toBe(
      'You are a GM context synthesizer for a Mothership RPG adventure.',
    );
  });
});
