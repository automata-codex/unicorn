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
  const pools = {
    hp: { current: 12, max: 15 },
    wounds: { current: 1, max: 3 },
    stress: { current: 4, max: null },
    strength: { current: 55, max: 55 },
    speed: { current: 40, max: 40 },
    intellect: { current: 35, max: 35 },
    combat: { current: 50, max: 60 },
    sanity: { current: 50, max: 50 },
    fear: { current: 30, max: 30 },
    body: { current: 40, max: 40 },
    credits: { current: 110, max: null },
  };

  it('renders identity, current Stats, current Saves, and vitals', () => {
    const prose = formatMothershipCharacterProse(vasquezSheet, pools);
    expect(prose).toContain('Vasquez (marine)');
    expect(prose).toContain(`Entity ID: ${vasquezSheet.entityId}`);
    expect(prose).toContain('STR 55');
    expect(prose).toContain('Sanity 50');
    expect(prose).toContain('Fear 30');
    expect(prose).toContain('Health: 12/15');
    expect(prose).toContain('Wounds: 1/3');
    expect(prose).toContain('Stress: 4');
  });

  it('renders a damaged Stat as current/max, not as its creation roll', () => {
    // Combat was rolled 8+6 = 14, so +25+10 = 49 at creation; the pool says it
    // is 50 of a 60 ceiling. Nothing here may come from `creationRolls` — the
    // rolls are what the dice showed, not what the character is now.
    const prose = formatMothershipCharacterProse(vasquezSheet, pools);
    expect(prose).toContain('CMB 50/60');
    expect(prose).not.toContain('CMB 49');
  });

  it('never renders INST — Instinct is a Contractor stat, not a player one', () => {
    expect(formatMothershipCharacterProse(vasquezSheet, pools)).not.toContain(
      'INST',
    );
  });

  it('never uses the name "Stress Threshold"', () => {
    expect(formatMothershipCharacterProse(vasquezSheet, pools)).not.toContain(
      'Stress Threshold',
    );
  });

  it('renders an em dash for a pool the character does not carry', () => {
    const prose = formatMothershipCharacterProse(vasquezSheet, {});
    expect(prose).toContain('STR —');
    expect(prose).toContain('Health: —');
  });

  it('includes trauma response, trinket and patch when present', () => {
    const prose = formatMothershipCharacterProse(vasquezSheet, pools);
    expect(prose).toContain('Trauma Response: When you Panic');
    expect(prose).toContain('Trinket: Bone Knife');
    expect(prose).toContain('Patch: "I Void Warranties"');
  });

  it('omits optional lines rather than rendering them empty', () => {
    const {
      trinket: _t,
      patch: _p,
      traumaResponse: _r,
      ...bare
    } = vasquezSheet;
    const prose = formatMothershipCharacterProse(bare, pools);
    expect(prose).not.toContain('Trinket:');
    expect(prose).not.toContain('Patch:');
    expect(prose).not.toContain('Trauma Response:');
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
    const prompt = buildMothershipSynthesisPrompt(vasquezSheet, baseSelections);
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
    expect(prompt).toContain('PLAYER CHARACTER:');
    expect(prompt).toContain('OPENING NARRATION:');
  });

  it('names the canonical entity id and forbids re-deriving one from the display name', () => {
    // The synthesis-side half of the duplicate-pool defect: the model was shown
    // only `name`, so it invented a prefix to build player pools out of.
    const prompt = buildMothershipSynthesisPrompt(vasquezSheet, baseSelections);
    expect(prompt).toContain(`Entity ID: ${vasquezSheet.entityId}`);
    expect(prompt).toContain(
      'Do not derive an identifier from the display name',
    );
    expect(prompt).toContain('Do not include them in initialState');
  });

  it('omits the addendum section when not provided', () => {
    const prompt = buildMothershipSynthesisPrompt(vasquezSheet, baseSelections);
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
    for (const label of [
      'Survivor',
      'Threat',
      'Secret',
      'Vessel Type',
      'Tone',
    ]) {
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
