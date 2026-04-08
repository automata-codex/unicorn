import type { AppState } from './types';

/**
 * Build the structured game state as an XML-wrapped JSON block.
 * Prepended to every user message so Claude has an authoritative
 * state snapshot without relying on its own tool call history.
 */
export function buildGameState(state: AppState): string {
	const gameState: Record<string, unknown> = {
		turn: state.turn
	};

	if (state.character) {
		gameState.character = {
			id: state.character.id,
			name: state.character.name,
			class: state.character.class,
			stats: state.character.stats,
			saves: state.character.saves
		};
	}

	gameState.resourcePools = state.resourcePools;

	const wounds = Object.entries(state.wounds).filter(([, w]) => w.length > 0);
	if (wounds.length) {
		gameState.wounds = Object.fromEntries(wounds);
	}

	gameState.entities = state.entities;
	gameState.flags = state.flags;
	gameState.flagTriggers = state.flagTriggers;
	gameState.npcStates = state.npcStates;

	let output = `<game_state>
${JSON.stringify(gameState, null, 2)}
</game_state>`;

	// Scenario state — human-readable format, one line per counter
	const scenarioEntries = Object.entries(state.scenarioState);
	if (scenarioEntries.length > 0) {
		const lines = scenarioEntries.map(([key, entry]) => {
			const value = entry.max != null ? `${entry.current}/${entry.max}` : `${entry.current}`;
			return entry.note ? `${key}: ${value} — ${entry.note}` : `${key}: ${value}`;
		});
		output += `\n\n<scenario_state>\n${lines.join('\n')}\n</scenario_state>`;
	}

	// World facts — key: value, one per line
	const worldFactEntries = Object.entries(state.worldFacts);
	if (worldFactEntries.length > 0) {
		const lines = worldFactEntries.map(([key, value]) => `${key}: ${value}`);
		output += `\n\n<world_facts>\n${lines.join('\n')}\n</world_facts>`;
	}

	return output;
}

/**
 * Build the canon log section — a compact narrative record of all
 * proposed canon from prior turns. Replaces full tool call history.
 */
export function buildCanonLog(state: AppState): string {
	if (state.canonLog.length === 0) return '';

	const entries = state.canonLog
		.map((c) => `- [Turn ${c.turn}] ${c.summary}`)
		.join('\n');

	return `[CANON LOG]
${entries}`;
}
