import type {
	AppState,
	MothershipCharacter,
	SubmitGmResponse,
	GmContextStructured
} from './types';

export function createAppState(overrides?: Partial<AppState>): AppState {
	const defaults: AppState = {
		// Setup
		apiKey: '',
		character: null,
		gmContextBlob: null,
		gmContextStructured: null,
		openingNarration: null,

		// Play
		resourcePools: {},
		wounds: {},
		entities: {},
		flags: {},
		flagTriggers: {},
		scenarioState: {},
		npcStates: {},
		pendingCanon: [],

		// Conversation
		messages: [],
		canonLog: [],
		turnLog: [],
		turn: 1,

		// UI
		view: 'setup',
		loading: false,
		pendingDiceRequests: [],
		errors: []
	};

	let appState = $state<AppState>({ ...defaults, ...overrides });
	return appState;
}

export function initializePlayerPools(state: AppState, character: MothershipCharacter): void {
	state.resourcePools[`${character.id}_hp`] = {
		current: character.maxHp,
		max: character.maxHp
	};
	state.resourcePools[`${character.id}_stress`] = {
		current: 0,
		max: null
	};
}

export function initializeFromGmContext(state: AppState, structured: GmContextStructured): void {
	for (const entity of structured.entities) {
		state.entities[entity.id] = {
			visible: entity.visible,
			status: entity.status ?? 'unknown',
			position: entity.startingPosition
		};
	}
	Object.assign(state.flags, structured.initialFlags);
	Object.assign(state.flagTriggers, structured.flagTriggers ?? {});

	// Initialize scenario state from initialState entries
	for (const [key, raw] of Object.entries(structured.initialState ?? {})) {
		const entry = raw as Record<string, unknown>;
		if (entry.current == null) {
			state.errors.push(`[warn] initialState entry "${key}" missing current value — skipping.`);
			continue;
		}
		state.scenarioState[key] = {
			current: entry.current as number,
			max: (entry.max as number) ?? null,
			note: (entry.note as string) ?? ''
		};
	}
}

export function applyGmResponse(state: AppState, response: SubmitGmResponse): void {
	// stateChanges.resourcePools
	for (const [poolName, { delta }] of Object.entries(response.stateChanges?.resourcePools ?? {})) {
		if (!(poolName in state.resourcePools)) {
			if (delta > 0) {
				state.resourcePools[poolName] = { current: delta, max: null };
				state.errors.push(`[info] Initialized pool ${poolName} = ${delta}`);
			} else {
				state.errors.push(
					`Unknown pool ${poolName} received negative delta — set initial value first.`
				);
			}
		} else {
			applyDelta(state, poolName, delta);
		}
	}

	// stateChanges.entities
	for (const [entityId, update] of Object.entries(response.stateChanges?.entities ?? {})) {
		state.entities[entityId] ??= { visible: true, status: 'unknown' };
		if (update.position !== undefined) state.entities[entityId].position = update.position;
		if (update.visible !== undefined) state.entities[entityId].visible = update.visible;
		if (update.status !== undefined) {
			state.entities[entityId].status = update.status;
			// When an entity dies, zero all resource pools prefixed with its ID
			if (update.status === 'dead') {
				const prefix = `${entityId}_`;
				for (const poolName of Object.keys(state.resourcePools)) {
					if (poolName.startsWith(prefix)) {
						state.resourcePools[poolName].current = 0;
					}
				}
			}
		}
	}

	// stateChanges.flagTriggers (merge before flags so triggers are in place for new flags)
	Object.assign(state.flagTriggers, response.stateChanges?.flagTriggers ?? {});

	// stateChanges.flags
	for (const [key, value] of Object.entries(response.stateChanges?.flags ?? {})) {
		if (!(key in state.flagTriggers)) {
			state.errors.push(`[warn] Flag "${key}" has no trigger description in flagTriggers.`);
		}
		state.flags[key] = value;
	}

	// stateChanges.scenarioStateUpdates
	for (const [key, newValue] of Object.entries(response.stateChanges?.scenarioStateUpdates ?? {})) {
		if (key in state.scenarioState) {
			state.scenarioState[key].current = newValue;
		} else {
			state.errors.push(`[warn] scenarioStateUpdate for unknown key "${key}" — ignoring.`);
		}
	}

	// gmUpdates.npcStates
	Object.assign(state.npcStates, response.gmUpdates?.npcStates ?? {});
	for (const [entityId, npcState] of Object.entries(response.gmUpdates?.npcStates ?? {})) {
		state.entities[entityId] ??= { visible: true, status: 'unknown' };
		state.entities[entityId].npcState = npcState;
	}

	// gmUpdates.proposedCanon
	const newCanon = response.gmUpdates?.proposedCanon ?? [];
	state.pendingCanon.push(...newCanon);
	for (const canon of newCanon) {
		state.canonLog.push({ turn: state.turn, ...canon });
	}

	// diceRequests
	if (response.diceRequests?.length) {
		state.pendingDiceRequests = response.diceRequests.map((r) => ({ ...r }));
	}
}

function applyDelta(state: AppState, poolName: string, delta: number): void {
	const pool = state.resourcePools[poolName];
	pool.current += delta;

	if (poolName.endsWith('_hp')) {
		// HP: allow negative, warn at 0 or below
		if (pool.current <= 0) {
			state.errors.push(
				`[warn] ${poolName} is at ${pool.current} — death threshold crossed.`
			);
		}
	} else {
		// Stress, ammo, etc.: floor at zero
		if (pool.current < 0) {
			state.errors.push(
				`[warn] ${poolName} would go to ${pool.current}, flooring at 0.`
			);
			pool.current = 0;
		}
	}
}
