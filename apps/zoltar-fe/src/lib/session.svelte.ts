import { writable } from 'svelte/store';

export type SessionUser = { id: string; email: string | null; name: string | null };
export const session = writable<SessionUser | null>(null);
export const sessionLoading = writable(true);

export async function loadSession() {
	try {
		const res = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/auth/me`, {
			credentials: 'include',
		});
		session.set(res.ok ? await res.json() : null);
	} catch {
		session.set(null);
	} finally {
		sessionLoading.set(false);
	}
}
