import type { AppState } from './types';

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

export function exportState(state: AppState): void {
	const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `zoltar-playtest-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

export function importState(file: File): Promise<AppState> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const state = JSON.parse(reader.result as string) as AppState;
				resolve(state);
			} catch (e) {
				reject(new Error('Failed to parse state file'));
			}
		};
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsText(file);
	});
}
