import type { RollDiceOutput } from './types';

export function executeDiceRoll(notation: string): RollDiceOutput {
	const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/);
	if (!match) throw new Error(`Invalid dice notation: ${notation}`);

	const count = parseInt(match[1]);
	const sides = parseInt(match[2]);
	const modifier = parseInt(match[3] ?? '0');

	const results = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
	const total = results.reduce((a, b) => a + b, 0) + modifier;

	return { notation, results, modifier, total };
}
