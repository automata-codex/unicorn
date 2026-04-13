import { writable } from 'svelte/store';

export const route = writable(window.location.pathname);

window.addEventListener('popstate', () => route.set(window.location.pathname));

export function navigate(path: string) {
  window.history.pushState({}, '', path);
  route.set(path);
}
