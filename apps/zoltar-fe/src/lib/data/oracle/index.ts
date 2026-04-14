import survivorsTable from './survivors.json';
import threatsTable from './threats.json';
import secretsTable from './secrets.json';
import vesselTypeTable from './vessel-type.json';
import toneTable from './tone.json';
import type { OracleCategory } from './types';

export const builtInOracleCategories: OracleCategory[] = [
  { id: survivorsTable.category, label: 'SURVIVORS', entries: survivorsTable.entries },
  { id: threatsTable.category, label: 'THREATS', entries: threatsTable.entries },
  { id: secretsTable.category, label: 'SECRETS', entries: secretsTable.entries },
  { id: vesselTypeTable.category, label: 'VESSEL TYPE', entries: vesselTypeTable.entries },
  { id: toneTable.category, label: 'TONE', entries: toneTable.entries },
];
