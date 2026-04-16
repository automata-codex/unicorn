import type { OracleEntry } from './oracle.schema';

import secretsTable from './data/secrets.json';
import survivorsTable from './data/survivors.json';
import threatsTable from './data/threats.json';
import toneTable from './data/tone.json';
import vesselTypeTable from './data/vessel-type.json';

export interface OracleCategory {
  id: string;
  label: string;
  entries: OracleEntry[];
}

export interface OracleTable {
  id: string;
  system: string;
  category: string;
  version: string;
  entries: OracleEntry[];
}

/**
 * Keyed by singular category name (matching `MothershipOracleSelectionsSchema`
 * field names), not by the plural names in the JSON `category` field.
 */
export const mothershipOracleTables = {
  survivor: survivorsTable as OracleTable,
  threat: threatsTable as OracleTable,
  secret: secretsTable as OracleTable,
  vessel_type: vesselTypeTable as OracleTable,
  tone: toneTable as OracleTable,
} as const;

export const mothershipOracleCategories: OracleCategory[] = [
  {
    id: survivorsTable.category,
    label: 'SURVIVORS',
    entries: survivorsTable.entries as OracleEntry[],
  },
  {
    id: threatsTable.category,
    label: 'THREATS',
    entries: threatsTable.entries as OracleEntry[],
  },
  {
    id: secretsTable.category,
    label: 'SECRETS',
    entries: secretsTable.entries as OracleEntry[],
  },
  {
    id: vesselTypeTable.category,
    label: 'VESSEL TYPE',
    entries: vesselTypeTable.entries as OracleEntry[],
  },
  {
    id: toneTable.category,
    label: 'TONE',
    entries: toneTable.entries as OracleEntry[],
  },
];

/**
 * Maps from the plural category id used in oracle JSON data files to the
 * singular key used in `MothershipOracleSelectionsSchema`. Categories that
 * are already singular (vessel_type, tone) map to themselves.
 */
export const mothershipCategoryToSelectionKey: Record<string, string> = {
  survivors: 'survivor',
  threats: 'threat',
  secrets: 'secret',
  vessel_type: 'vessel_type',
  tone: 'tone',
};

/**
 * Returns all entries for the given Mothership oracle category. Used by the
 * backend coherence check to supply active pools for rerolling.
 */
export function getMothershipOraclePool(
  category: keyof typeof mothershipOracleTables,
): OracleEntry[] {
  return mothershipOracleTables[category].entries as OracleEntry[];
}
