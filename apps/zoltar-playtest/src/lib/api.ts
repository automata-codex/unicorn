import type { AppState, MothershipCharacter, OracleEntry, SubmitGmContext } from './types';
import { applyGmResponse, initializeFromGmContext } from './state.svelte';
import { buildSnapshot } from './snapshot';
import { executeDiceRoll } from './dice';
import { PLAY_TOOLS, SYNTHESIS_TOOLS } from './tools';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const API_VERSION = '2023-06-01';

// Keep the most recent N messages when building API requests.
// The current state snapshot is always in the latest user message,
// so older turns provide narrative context but aren't structurally required.
const MAX_HISTORY_MESSAGES = 40;

// --- Message trimming ---

function trimHistory(messages: ApiMessage[]): ApiMessage[] {
	if (messages.length <= MAX_HISTORY_MESSAGES) return messages;

	let trimmed = messages.slice(-MAX_HISTORY_MESSAGES);

	// Drop messages from the front until we reach a user message whose content
	// is a plain string (i.e. a player action, not a tool_result). This ensures
	// we never start with an orphaned tool_result that references a tool_use
	// that was trimmed away.
	while (trimmed.length > 0) {
		const first = trimmed[0];
		if (first.role === 'user' && typeof first.content === 'string') break;
		trimmed = trimmed.slice(1);
	}

	return trimmed;
}

// --- Raw API call ---

type ApiMessage = {
	role: string;
	content: unknown;
};

type ToolUseBlock = {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, unknown>;
};

type ApiResponse = {
	content: unknown[];
	stop_reason: string;
};

async function callAnthropic(
	apiKey: string,
	system: string,
	messages: ApiMessage[],
	tools: readonly Record<string, unknown>[],
	toolChoice: Record<string, unknown>
): Promise<ApiResponse> {
	const response = await fetch(API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': API_VERSION,
			'anthropic-dangerous-direct-browser-access': 'true'
		},
		body: JSON.stringify({
			model: MODEL,
			max_tokens: 4096,
			system,
			messages,
			tools,
			tool_choice: toolChoice
		})
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`API error ${response.status}: ${body}`);
	}

	return response.json() as Promise<ApiResponse>;
}

function extractToolUse(response: ApiResponse): ToolUseBlock | null {
	const block = response.content.find(
		(b: unknown) => (b as Record<string, unknown>).type === 'tool_use'
	);
	return (block as ToolUseBlock) ?? null;
}

// --- System prompt ---

export function buildSystemPrompt(state: AppState): string {
	const gmContext = state.gmContextBlob ?? '';

	return `You are the Warden for a solo Mothership adventure. You are running a horror scenario on a derelict vessel.

${gmContext}

WARDEN INSTRUCTIONS:
- You must call submit_gm_response to complete every turn. Never respond with plain text.
- Call roll_dice for any roll the player does not make themselves — NPC actions, GM saves, random resolutions.
- Use diceRequests in submit_gm_response for rolls the player makes.
- All numeric resources — HP, stress, ammo — are tracked via resourcePools using delta values. Pool names follow the pattern {entity_id}_{pool_name} with underscores only.
- Before referencing an NPC's resource pool in combat, establish it with a positive delta (e.g. xenomorph_hp: { delta: 45 }). A negative delta on an unknown pool is an error.
- Entity identifiers from the GM context structured section are the canonical identifiers for all tool calls. Use them exactly.
- Panic is an event, not a pool. When stress crosses a threshold requiring a panic check, call roll_dice and narrate the result. Set a flag for any lasting panic condition.
- You know everything the Warden knows. Reveal GM context secrets only when fictionally appropriate — when the character could plausibly perceive or discover them.
- playerText is the only thing the player sees. Everything else is backend state.`;
}

// --- Synthesis prompt ---

function formatCharacterProse(c: MothershipCharacter): string {
	return `${c.name} (${c.class})
Stats: STR ${c.stats.strength}, SPD ${c.stats.speed}, INT ${c.stats.intellect}, CMB ${c.stats.combat}
Saves: Fear ${c.saves.fear}, Sanity ${c.saves.sanity}, Body ${c.saves.body}, Armor ${c.saves.armor}
HP: ${c.maxHp}
Skills: ${c.skills.join(', ')}`;
}

function formatOracleForSynthesis(label: string, entry: OracleEntry): string {
	let text = `${label}: ${entry.claude_text}`;
	if (entry.interfaces.length) {
		const hints = entry.interfaces
			.map((i) => `  - If ${i.condition}: ${i.note}`)
			.join('\n');
		text += `\n${hints}`;
	}
	return text;
}

export type OracleSelections = {
	survivor: OracleEntry;
	threat: OracleEntry;
	secret: OracleEntry;
	vessel_type: OracleEntry;
	tone: OracleEntry;
};

function buildSynthesisPrompt(
	character: MothershipCharacter,
	selections: OracleSelections
): string {
	return `You are synthesizing a GM context for a solo Mothership adventure.

CHARACTER:
${formatCharacterProse(character)}

ORACLE RESULTS:
${formatOracleForSynthesis('Survivor', selections.survivor)}

${formatOracleForSynthesis('Threat', selections.threat)}

${formatOracleForSynthesis('Secret', selections.secret)}

${formatOracleForSynthesis('Vessel Type', selections.vessel_type)}

${formatOracleForSynthesis('Tone', selections.tone)}

Synthesize a coherent GM context from these elements. Make connections between the oracle results — the interface hints suggest natural combinations. Call submit_gm_context when complete.`;
}

// --- Turn loop ---

export async function runTurn(state: AppState, playerAction: string): Promise<boolean> {
	state.loading = true;
	state.errors = [];
	let success = false;

	try {
		const userMessage = `${buildSnapshot(state)}\n\n${playerAction}`;
		const messages: ApiMessage[] = trimHistory([
			...state.messages,
			{ role: 'user', content: userMessage }
		]);

		while (true) {
			const response = await callAnthropic(
				state.apiKey,
				buildSystemPrompt(state),
				messages,
				PLAY_TOOLS,
				{ type: 'any' }
			);

			const toolUse = extractToolUse(response);

			if (!toolUse) {
				state.errors.push('Unexpected response: no tool call found.');
				break;
			}

			if (toolUse.name === 'roll_dice') {
				const result = executeDiceRoll(toolUse.input.notation as string);
				messages.push({ role: 'assistant', content: response.content });
				messages.push({
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: toolUse.id,
							content: JSON.stringify(result)
						}
					]
				});
			} else if (toolUse.name === 'submit_gm_response') {
				applyGmResponse(state, toolUse.input as unknown as import('./types').SubmitGmResponse);
				messages.push({ role: 'assistant', content: response.content });
				// Acknowledge the tool call so the next turn's history is valid
				messages.push({
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: toolUse.id,
							content: 'State updated.'
						}
					]
				});
				state.messages = messages as AppState['messages'];
				state.turn++;
				success = true;
				break;
			} else {
				state.errors.push(`Unexpected tool call: ${toolUse.name}`);
				break;
			}
		}
	} catch (e) {
		state.errors.push(e instanceof Error ? e.message : String(e));
	} finally {
		state.loading = false;
	}
	return success;
}

// --- Synthesis ---

export async function runSynthesis(
	state: AppState,
	selections: OracleSelections
): Promise<void> {
	if (!state.character) throw new Error('Character required for synthesis');

	state.loading = true;
	state.errors = [];

	try {
		const prompt = buildSynthesisPrompt(state.character, selections);
		const messages: ApiMessage[] = [{ role: 'user', content: prompt }];

		const response = await callAnthropic(
			state.apiKey,
			'You are a GM context synthesizer for a Mothership RPG adventure.',
			messages,
			SYNTHESIS_TOOLS,
			{ type: 'any' }
		);

		const toolUse = extractToolUse(response);

		if (!toolUse || toolUse.name !== 'submit_gm_context') {
			state.errors.push('Synthesis failed: expected submit_gm_context tool call.');
			return;
		}

		const context = toolUse.input as unknown as SubmitGmContext;
		state.gmContextBlob = JSON.stringify(context.narrative, null, 2);
		state.gmContextStructured = context.structured;
		initializeFromGmContext(state, context.structured);
	} catch (e) {
		state.errors.push(e instanceof Error ? e.message : String(e));
	} finally {
		state.loading = false;
	}
}
