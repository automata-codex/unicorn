import type { AppState, GameMessage, TurnLogEntry } from './types';

const API_KEY_KEY = 'zoltar_playtest_api_key';
const STATE_KEY = 'zoltar_playtest_state';

export function loadApiKey(): string {
	return localStorage.getItem(API_KEY_KEY) ?? '';
}

export function saveApiKey(key: string): void {
	localStorage.setItem(API_KEY_KEY, key);
}

export function loadState(): Partial<AppState> | null {
	const raw = localStorage.getItem(STATE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Partial<AppState>;
	} catch {
		return null;
	}
}

export function saveState(state: AppState): void {
	localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

// --- Session export/import ---

export type SessionExport = {
	version: 1;
	exportedAt: string;
	turnLog: TurnLogEntry[];
	messages: GameMessage[];
	canonLog: Array<{ turn: number; summary: string; context: string }>;
	finalState: {
		turn: number;
		character: AppState['character'];
		resourcePools: AppState['resourcePools'];
		wounds: AppState['wounds'];
		entities: AppState['entities'];
		flags: AppState['flags'];
		flagTriggers: AppState['flagTriggers'];
		npcStates: AppState['npcStates'];
		pendingCanon: AppState['pendingCanon'];
		pendingDiceRequests: AppState['pendingDiceRequests'];
	};
	gmContextBlob: string;
	gmContextStructured: AppState['gmContextStructured'];
	openingNarration: string | null;
};

export function exportSession(state: AppState): void {
	const data: SessionExport = {
		version: 1,
		exportedAt: new Date().toISOString(),
		turnLog: state.turnLog,
		messages: state.messages,
		canonLog: state.canonLog,
		finalState: {
			turn: state.turn,
			character: state.character,
			resourcePools: state.resourcePools,
			wounds: state.wounds,
			entities: state.entities,
			flags: state.flags,
			flagTriggers: state.flagTriggers,
			npcStates: state.npcStates,
			pendingCanon: state.pendingCanon,
			pendingDiceRequests: state.pendingDiceRequests,
		},
		gmContextBlob: state.gmContextBlob ?? '',
		gmContextStructured: state.gmContextStructured,
		openingNarration: state.openingNarration,
	};

	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `zoltar-playtest-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

export function parseSessionFile(file: File): Promise<SessionExport> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const data = JSON.parse(reader.result as string);
				if (!data.version || data.version !== 1) {
					reject(new Error('Unrecognized session file format.'));
					return;
				}
				if (!data.messages || !data.finalState) {
					reject(new Error('Invalid session file: missing required fields.'));
					return;
				}
				resolve(data as SessionExport);
			} catch {
				reject(new Error('Failed to parse session file.'));
			}
		};
		reader.onerror = () => reject(new Error('Failed to read file.'));
		reader.readAsText(file);
	});
}

export function restoreSession(state: AppState, session: SessionExport): void {
	// Restore conversation
	state.messages = session.messages;
	state.canonLog = session.canonLog;
	state.turnLog = session.turnLog;

	// Restore game state
	state.turn = session.finalState.turn;
	state.character = session.finalState.character;
	state.resourcePools = session.finalState.resourcePools;
	state.wounds = session.finalState.wounds;
	state.entities = session.finalState.entities;
	state.flags = session.finalState.flags;
	state.flagTriggers = session.finalState.flagTriggers;
	state.npcStates = session.finalState.npcStates;
	state.pendingCanon = session.finalState.pendingCanon;
	state.pendingDiceRequests = session.finalState.pendingDiceRequests;

	// Restore GM context
	state.gmContextBlob = session.gmContextBlob;
	state.gmContextStructured = session.gmContextStructured;
	state.openingNarration = session.openingNarration;

	// Ensure we're in play view
	state.view = 'play';
	state.errors = [];
	state.loading = false;
}
