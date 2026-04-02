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

		// Play
		resourcePools: {},
		wounds: {},
		entities: {},
		flags: {},
		npcStates: {},
		pendingCanon: [],

		// Conversation
		messages: [],
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
			position: entity.startingPosition
		};
	}
	Object.assign(state.flags, structured.initialFlags);
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
		state.entities[entityId] ??= { visible: true };
		if (update.position !== undefined) state.entities[entityId].position = update.position;
		if (update.visible !== undefined) state.entities[entityId].visible = update.visible;
	}

	// stateChanges.flags
	Object.assign(state.flags, response.stateChanges?.flags ?? {});

	// gmUpdates.npcStates
	Object.assign(state.npcStates, response.gmUpdates?.npcStates ?? {});
	for (const [entityId, npcState] of Object.entries(response.gmUpdates?.npcStates ?? {})) {
		state.entities[entityId] ??= { visible: true };
		state.entities[entityId].npcState = npcState;
	}

	// gmUpdates.proposedCanon
	state.pendingCanon.push(...(response.gmUpdates?.proposedCanon ?? []));

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
