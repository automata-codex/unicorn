import type {
  MothershipCharacterSheet,
  MothershipOracleSelections,
  OracleEntry,
} from '@uv/game-systems';

export const vasquezSheet: MothershipCharacterSheet = {
  entityId: 'vasquez',
  name: 'Vasquez',
  pronouns: 'she/her',
  class: 'marine',
  level: 1,
  stats: {
    strength: 55,
    speed: 40,
    intellect: 35,
    combat: 60,
    instinct: 45,
    sanity: 50,
  },
  saves: { fear: 30, body: 40, armor: 10, armorMax: 20 },
  maxHp: 15,
  maxStress: 20,
  skills: ['Military Training', 'Firearms'],
  equipment: ['Combat Armor', 'Pulse Rifle'],
};

export function makeOracleEntry(
  id: string,
  claudeText = 'seed text',
): OracleEntry {
  return {
    id,
    player_text: `player view: ${id}`,
    claude_text: claudeText,
    interfaces: [{ condition: 'threat', note: 'linked' }],
    tags: ['demo'],
  };
}

export const baseSelections: MothershipOracleSelections = {
  survivor: makeOracleEntry('survivor_1'),
  threat: makeOracleEntry('threat_1'),
  secret: makeOracleEntry('secret_1'),
  vessel_type: makeOracleEntry('vessel_1'),
  tone: makeOracleEntry('tone_1'),
};

export const baseActivePools = {
  survivor: [makeOracleEntry('survivor_1'), makeOracleEntry('survivor_2')],
  threat: [makeOracleEntry('threat_1'), makeOracleEntry('threat_2')],
  secret: [makeOracleEntry('secret_1')],
  vessel_type: [makeOracleEntry('vessel_1'), makeOracleEntry('vessel_2')],
  tone: [makeOracleEntry('tone_1'), makeOracleEntry('tone_2')],
};
