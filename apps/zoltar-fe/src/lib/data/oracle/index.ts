import secretsTable from '@uv/game-systems/src/mothership/data/secrets.json';
import survivorsTable from '@uv/game-systems/src/mothership/data/survivors.json';
import threatsTable from '@uv/game-systems/src/mothership/data/threats.json';
import toneTable from '@uv/game-systems/src/mothership/data/tone.json';
import vesselTypeTable from '@uv/game-systems/src/mothership/data/vessel-type.json';

import type { OracleCategory } from './types';

export const builtInOracleCategories: OracleCategory[] = [
  {
    id: survivorsTable.category,
    label: 'SURVIVORS',
    entries: survivorsTable.entries,
  },
  {
    id: threatsTable.category,
    label: 'THREATS',
    entries: threatsTable.entries,
  },
  {
    id: secretsTable.category,
    label: 'SECRETS',
    entries: secretsTable.entries,
  },
  {
    id: vesselTypeTable.category,
    label: 'VESSEL TYPE',
    entries: vesselTypeTable.entries,
  },
  { id: toneTable.category, label: 'TONE', entries: toneTable.entries },
];
