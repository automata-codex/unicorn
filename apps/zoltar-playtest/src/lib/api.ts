import type { AppState, MothershipCharacter, OracleEntry, SubmitGmContext, TurnLogEntry } from './types';
import { applyGmResponse, initializeFromGmContext } from './state.svelte';
import { buildGameState, buildCanonLog } from './snapshot';
import { executeDiceRoll } from './dice';
import { PLAY_TOOLS, SYNTHESIS_TOOLS } from './tools';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const API_VERSION = '2023-06-01';

// Number of recent player/warden exchange pairs to include in the rolling window.
// Each "exchange" is a player action + warden response (simplified to playerText).
const RECENT_EXCHANGE_COUNT = 6;

// --- Reconstructed context window ---

type RecentExchange = {
	playerAction: string;
	wardenResponse: string;
};

/**
 * Extract simplified recent exchanges from the full message history.
 * Strips tool call internals — only player actions and warden playerText.
 */
function extractRecentExchanges(messages: ApiMessage[]): RecentExchange[] {
	const exchanges: RecentExchange[] = [];
	let currentAction: string | null = null;

	for (const msg of messages) {
		if (msg.role === 'user' && typeof msg.content === 'string') {
			// Extract player action (after the game state / snapshot prefix)
			const text = msg.content as string;
			// Look for the player input after any prefixed state blocks
			const playerMarker = '[PLAYER INPUT]\n';
			const markerIdx = text.indexOf(playerMarker);
			if (markerIdx !== -1) {
				currentAction = text.slice(markerIdx + playerMarker.length).trim();
			} else {
				// Fallback: take the last paragraph (old format or plain text)
				const parts = text.split('\n\n');
				currentAction = parts[parts.length - 1].trim();
			}
		} else if (msg.role === 'assistant' && currentAction) {
			// Extract playerText from submit_gm_response tool calls
			const content = msg.content;
			if (Array.isArray(content)) {
				for (const block of content as Record<string, unknown>[]) {
					if (block.type === 'tool_use' && block.name === 'submit_gm_response') {
						const input = block.input as Record<string, unknown>;
						if (input.playerText) {
							exchanges.push({
								playerAction: currentAction!,
								wardenResponse: input.playerText as string
							});
							currentAction = null;
						}
					}
				}
			}
		}
	}

	return exchanges;
}

/**
 * Build the user message for a turn using the reconstructed context window.
 * Components: game state (XML) + canon log + recent exchanges + player action.
 */
function buildUserMessage(state: AppState, playerAction: string): string {
	const parts: string[] = [];

	// 1. Authoritative game state
	parts.push('[CURRENT GAME STATE]');
	parts.push(buildGameState(state));

	// 2. Canon log (compact narrative record from all prior turns)
	const canonLog = buildCanonLog(state);
	if (canonLog) {
		parts.push(canonLog);
	}

	// 3. Recent exchanges (rolling window for dialogue continuity)
	const exchanges = extractRecentExchanges(state.messages);
	const recent = exchanges.slice(-RECENT_EXCHANGE_COUNT);
	if (recent.length > 0) {
		parts.push('[RECENT EXCHANGES]');
		for (const ex of recent) {
			parts.push(`Player: ${ex.playerAction}`);
			parts.push(`Warden: ${ex.wardenResponse}`);
			parts.push('');
		}
	}

	// 4. Current player action
	parts.push('[PLAYER INPUT]');
	parts.push(playerAction);

	return parts.join('\n');
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
	usage?: {
		input_tokens: number;
		output_tokens: number;
	};
};

function withCacheBreakpoint(messages: ApiMessage[]): ApiMessage[] {
	if (messages.length === 0) return messages;

	// Add a cache breakpoint to the second-to-last message (the end of
	// the prior turn's history). The last message is the new user action
	// and changes every turn, but everything before it is identical to
	// the previous API call and should hit the cache.
	if (messages.length < 2) return messages;

	const result = [...messages];
	const target = result[result.length - 2];
	const content = target.content;

	if (typeof content === 'string') {
		result[result.length - 2] = {
			...target,
			content: [
				{ type: 'text', text: content, cache_control: { type: 'ephemeral' } }
			]
		};
	} else if (Array.isArray(content) && content.length > 0) {
		const blocks = [...content as Record<string, unknown>[]];
		const last = blocks[blocks.length - 1];
		blocks[blocks.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
		result[result.length - 2] = { ...target, content: blocks };
	}

	return result;
}

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
			system: [
				{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }
			],
			messages: withCacheBreakpoint(messages),
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

function extractToolUses(response: ApiResponse): ToolUseBlock[] {
	return response.content.filter(
		(b: unknown) => (b as Record<string, unknown>).type === 'tool_use'
	) as ToolUseBlock[];
}

// --- System prompt ---

export function buildSystemPrompt(state: AppState): string {
	const gmContext = state.gmContextBlob ?? '';
	const systemPrompt = state.promptText.system || '';
	const generalWarden = state.promptText.generalWarden || '';

	// Structure: [system-specific preamble + GM context] + [general warden instructions]
	return `${systemPrompt}

${gmContext}

${generalWarden}`.trim();
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
	return `${label}:
${JSON.stringify(entry, null, 2)}`;
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
	selections: OracleSelections,
	addendum?: string
): string {
	let prompt = `You are synthesizing a GM context for a solo Mothership adventure.

CHARACTER:
${formatCharacterProse(character)}

ORACLE RESULTS:
${formatOracleForSynthesis('Survivor', selections.survivor)}

${formatOracleForSynthesis('Threat', selections.threat)}

${formatOracleForSynthesis('Secret', selections.secret)}

${formatOracleForSynthesis('Vessel Type', selections.vessel_type)}

${formatOracleForSynthesis('Tone', selections.tone)}

Each oracle entry includes an id, claude_text (the narrative seed), interfaces (hints for how entries connect across categories), and tags. Use the id values as the basis for entity IDs and flag keys in the structured output. Use the interfaces array to wire entries together coherently — condition values indicate which other entries this one connects to. Synthesize a coherent GM context from these elements and call submit_gm_context when complete.

FLAG TRIGGERS:
Every flag in initialFlags must have a corresponding entry in flagTriggers. Each trigger must name the specific in-fiction action or event that flips the flag — not just what the flag represents. Example: "Flip to true when Jones physically accesses Draven's datapad or terminal and reads the synthesis notes. Accessing the room is not sufficient — the notes must be read."

REQUIRED FLAG — adventure_complete:
Every scenario must include adventure_complete: false in initialFlags with a corresponding trigger in flagTriggers that names the specific end condition for this adventure.

COUNTDOWN TIMERS:
Any mechanic that involves a number counting down over the course of the adventure must be initialized as a named resource pool in initialState. Use the naming convention {entity_id}_timer — e.g. crewman_wick_timer: { current: 4, max: 4 }. Do not track countdowns as freeform state or narrative-only values.

OPENING NARRATION:
Write an openingNarration field — this is the first message the Warden delivers before the player acts. It establishes the immediate physical situation, conveys the atmosphere, and contains one concrete detail the player did not put there — something that signals the world has already been in motion without them. Do not end with exposition; end with a moment that invites the player's first action.

MECHANICAL NOTES:
Any scenario-specific mechanical guidance (e.g. "the first organism encounter is a mandatory Fear save") belongs in the freeform notes supplied by the scenario author, not in the base GM context. The narrative and structured outputs should remain system-agnostic.`;

	if (addendum?.trim()) {
		prompt += `\n\nADDITIONAL DIRECTION:\n${addendum.trim()}`;
	}

	return prompt;
}

// --- Turn loop ---

export async function runTurn(
	state: AppState,
	playerAction: string,
	playerDiceRolls?: TurnLogEntry['diceRolls']
): Promise<boolean> {
	state.loading = true;
	state.errors = [];
	let success = false;

	try {
		// Build a fresh reconstructed context window each turn.
		// Only the current user message + any mid-turn tool exchanges are sent.
		// Prior turns are represented by the canon log + recent exchanges summary
		// inside the user message, not by raw message history.
		const userMessage = buildUserMessage(state, playerAction);
		const messages: ApiMessage[] = [
			{ role: 'user', content: userMessage }
		];

		// Capture the snapshot sent this turn for the turn log
		const snapshotSent = JSON.parse(
			buildGameState(state).replace(/^<game_state>\n/, '').replace(/\n<\/game_state>$/, '')
		);

		// Accumulate dice rolls across the tool loop for the turn log.
		// Include any player dice rolls from the previous turn's diceRequests.
		const diceRolls: TurnLogEntry['diceRolls'] = [...(playerDiceRolls ?? [])];

		// Track token usage across all API calls in this turn
		let totalPromptTokens = 0;
		let totalCompletionTokens = 0;

		while (true) {
			const response = await callAnthropic(
				state.apiKey,
				buildSystemPrompt(state),
				messages,
				PLAY_TOOLS,
				{ type: 'any' }
			);

			totalPromptTokens += response.usage?.input_tokens ?? 0;
			totalCompletionTokens += response.usage?.output_tokens ?? 0;

			const toolUses = extractToolUses(response);

			if (toolUses.length === 0) {
				state.errors.push('Unexpected response: no tool call found.');
				break;
			}

			// Process all tool_use blocks and build tool_results for each.
			// A single response can contain multiple roll_dice calls and/or
			// a submit_gm_response — we must provide a tool_result for every
			// tool_use, or the next API call will reject.
			const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
			let gmResponse: import('./types').SubmitGmResponse | null = null;
			let hasUnknownTool = false;

			for (const tu of toolUses) {
				if (tu.name === 'roll_dice') {
					const result = executeDiceRoll(tu.input.notation as string);
					diceRolls.push({
						purpose: tu.input.purpose as string,
						notation: tu.input.notation as string,
						result: result.total,
						source: 'system'
					});
					toolResults.push({
						type: 'tool_result',
						tool_use_id: tu.id,
						content: JSON.stringify(result)
					});
				} else if (tu.name === 'submit_gm_response') {
					gmResponse = tu.input as unknown as import('./types').SubmitGmResponse;
					toolResults.push({
						type: 'tool_result',
						tool_use_id: tu.id,
						content: JSON.stringify({ status: 'ok' })
					});
				} else {
					state.errors.push(`Unexpected tool call: ${tu.name}`);
					toolResults.push({
						type: 'tool_result',
						tool_use_id: tu.id,
						content: JSON.stringify({ error: `Unknown tool: ${tu.name}` })
					});
					hasUnknownTool = true;
				}
			}

			// Always push the assistant message and all tool results together
			messages.push({ role: 'assistant', content: response.content });
			messages.push({ role: 'user', content: toolResults });

			if (hasUnknownTool && !gmResponse) {
				break;
			}

			if (gmResponse) {
				applyGmResponse(state, gmResponse);

				const now = new Date().toISOString();

				// Store the full exchange in message history for extraction by
				// future turns' extractRecentExchanges and for export/review.
				state.messages.push({
					role: 'user',
					content: userMessage,
					turn: state.turn,
					timestamp: now
				});
				state.messages.push({
					role: 'assistant',
					content: response.content as unknown as string,
					turn: state.turn,
					timestamp: now
				});

				// Build and append the turn log entry
				state.turnLog.push({
					turn: state.turn,
					snapshotSent,
					stateChanges: gmResponse.stateChanges ?? null,
					diceRolls,
					tokens: {
						promptTokens: totalPromptTokens,
						completionTokens: totalCompletionTokens
					},
					scenarioStateSnapshot: Object.keys(state.scenarioState).length > 0
						? structuredClone(state.scenarioState)
						: undefined,
					worldFactsSnapshot: Object.keys(state.worldFacts).length > 0
						? { ...state.worldFacts }
						: undefined
				});

				state.turn++;
				success = true;
				break;
			}

			// No submit_gm_response yet — continue the tool loop
			// (Claude made roll_dice calls and needs to see results before submitting)
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
	selections: OracleSelections,
	addendum?: string
): Promise<void> {
	if (!state.character) throw new Error('Character required for synthesis');

	state.loading = true;
	state.errors = [];

	try {
		const prompt = buildSynthesisPrompt(state.character, selections, addendum);
		const messages: ApiMessage[] = [{ role: 'user', content: prompt }];

		const response = await callAnthropic(
			state.apiKey,
			'You are a GM context synthesizer for a Mothership RPG adventure.',
			messages,
			SYNTHESIS_TOOLS,
			{ type: 'any' }
		);

		const toolUse = extractToolUses(response)[0] ?? null;

		if (!toolUse || toolUse.name !== 'submit_gm_context') {
			state.errors.push('Synthesis failed: expected submit_gm_context tool call.');
			return;
		}

		const context = toolUse.input as unknown as SubmitGmContext;
		state.gmContextBlob = JSON.stringify(context.narrative, null, 2);
		state.gmContextStructured = context.structured;
		state.openingNarration = context.openingNarration ?? null;
		initializeFromGmContext(state, context.structured);

		// Validate adventure_complete flag
		if (!('adventure_complete' in (context.structured.initialFlags ?? {}))) {
			state.errors.push('[warn] Synthesis output is missing required adventure_complete flag.');
		}
	} catch (e) {
		state.errors.push(e instanceof Error ? e.message : String(e));
	} finally {
		state.loading = false;
	}
}
