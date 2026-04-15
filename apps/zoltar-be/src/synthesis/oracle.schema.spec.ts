import { describe, expect, it } from 'vitest';
import {
  MothershipOracleSelectionsSchema,
  OracleEntrySchema,
  oracleSchemas,
} from '@uv/game-systems';

const validEntry = {
  id: 'survivor_01',
  player_text: 'A haggard engineer with a head wound.',
  claude_text: 'The sole conscious survivor: Chief Engineer Vale.',
  interfaces: [
    { condition: 'threat', note: 'Knows what caused the breach.' },
  ],
  tags: ['survivor', 'injured'],
};

const validSelections = {
  survivor: validEntry,
  threat: { ...validEntry, id: 'threat_02' },
  secret: { ...validEntry, id: 'secret_03' },
  vessel_type: { ...validEntry, id: 'vessel_04' },
  tone: { ...validEntry, id: 'tone_05' },
};

describe('OracleEntrySchema', () => {
  it('parses a valid entry', () => {
    expect(() => OracleEntrySchema.parse(validEntry)).not.toThrow();
  });

  it('rejects an entry missing claude_text', () => {
    const { claude_text: _omit, ...rest } = validEntry;
    expect(() => OracleEntrySchema.parse(rest)).toThrow();
  });

  it('rejects an entry with a non-array interfaces field', () => {
    expect(() =>
      OracleEntrySchema.parse({ ...validEntry, interfaces: {} }),
    ).toThrow();
  });
});

describe('MothershipOracleSelectionsSchema', () => {
  it('parses all five required categories', () => {
    const result = MothershipOracleSelectionsSchema.parse(validSelections);
    expect(result.survivor.id).toBe('survivor_01');
    expect(result.tone.id).toBe('tone_05');
  });

  it('rejects when a required category is missing', () => {
    const { tone: _omit, ...rest } = validSelections;
    expect(() => MothershipOracleSelectionsSchema.parse(rest)).toThrow();
  });
});

describe('oracleSchemas registry', () => {
  it('exposes the mothership schema under the system slug', () => {
    expect(oracleSchemas.mothership).toBe(MothershipOracleSelectionsSchema);
  });
});
