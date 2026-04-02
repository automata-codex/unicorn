import type { AppState } from './types';

export function buildSnapshot(state: AppState): string {
	const lines: string[] = [];

	lines.push(`## Current State — Turn ${state.turn}`);
	lines.push('');

	// Character
	if (state.character) {
		const c = state.character;
		const hpPool = state.resourcePools[`${c.id}_hp`];
		const stressPool = state.resourcePools[`${c.id}_stress`];
		const wounds = state.wounds[c.id];

		lines.push(`**${c.name}** (${c.class})`);

		const hpStr = hpPool ? `${hpPool.current}/${hpPool.max}` : '?';
		const stressStr = stressPool ? `${stressPool.current}` : '0';
		const woundStr = wounds?.length ? wounds.join(', ') : 'none';
		lines.push(`HP: ${hpStr} | Stress: ${stressStr} | Wounds: ${woundStr}`);

		lines.push(
			`Stats: STR ${c.stats.strength} | SPD ${c.stats.speed} | INT ${c.stats.intellect} | CMB ${c.stats.combat}`
		);
		lines.push(
			`Saves: Fear ${c.saves.fear} | Sanity ${c.saves.sanity} | Body ${c.saves.body} | Armor ${c.saves.armor}`
		);
		lines.push(`Skills: ${c.skills.join(', ')}`);
		lines.push('');
	}

	// Resource Pools (omit empty/zero except HP and stress)
	const poolEntries = Object.entries(state.resourcePools).filter(([name, pool]) => {
		if (name.endsWith('_hp') || name.endsWith('_stress')) return true;
		return pool.current !== 0;
	});
	if (poolEntries.length) {
		lines.push('**Resource Pools**');
		for (const [name, pool] of poolEntries) {
			const maxStr = pool.max != null ? `/${pool.max}` : '';
			lines.push(`${name}: ${pool.current}${maxStr}`);
		}
		lines.push('');
	}

	// Entities
	const entityEntries = Object.entries(state.entities).filter(
		([, e]) => e.position != null || e.npcState != null || !e.visible
	);
	if (entityEntries.length) {
		lines.push('**Entities**');
		for (const [id, e] of entityEntries) {
			let line = `${id}: ${e.visible ? 'visible' : 'hidden'}`;
			if (e.position) line += `, position (${e.position.x}, ${e.position.y})`;
			if (e.npcState) line += `, "${e.npcState}"`;
			lines.push(line);
		}
		lines.push('');
	}

	// Flags
	const flagEntries = Object.entries(state.flags);
	if (flagEntries.length) {
		lines.push('**Flags**');
		for (const [name, value] of flagEntries) {
			lines.push(`${name}: ${value}`);
		}
		lines.push('');
	}

	// Pending Canon
	if (state.pendingCanon.length) {
		lines.push('**Pending Canon**');
		for (const canon of state.pendingCanon) {
			lines.push(`- ${canon.summary}`);
		}
		lines.push('');
	}

	return lines.join('\n').trimEnd();
}
