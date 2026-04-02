import type { OracleTable, OracleEntry } from './types';

const TABLE_FILES = ['survivors', 'threats', 'secrets', 'vessel-type', 'tone'];

export async function loadOracleTables(): Promise<Record<string, OracleTable>> {
	const tables: Record<string, OracleTable> = {};

	const results = await Promise.all(
		TABLE_FILES.map(async (file) => {
			const response = await fetch(`/oracle-tables/${file}.json`);
			if (!response.ok) throw new Error(`Failed to load oracle table: ${file}`);
			return response.json() as Promise<OracleTable>;
		})
	);

	for (const table of results) {
		tables[table.category] = table;
	}

	return tables;
}

export function pickRandom(entries: OracleEntry[]): OracleEntry {
	if (entries.length === 0) throw new Error('No entries to pick from');
	return entries[Math.floor(Math.random() * entries.length)];
}
