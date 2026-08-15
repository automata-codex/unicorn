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
  trinket: 'Bone Knife',
  patch: '"I Void Warranties"',
  traumaResponse:
    'When you Panic, everyone within earshot must make a Fear Save.',
  creationRolls: {
    strength: [7, 4],
    speed: [3, 9],
    intellect: [5, 5],
    combat: [8, 6],
    sanity: [2, 7],
    fear: [6, 6],
    body: [4, 3],
    maxHp: [5],
    credits: [9, 2],
    trinket: [42],
    patch: [17],
  },
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
