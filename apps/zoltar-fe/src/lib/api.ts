const API_URL = import.meta.env.VITE_API_URL;

export async function api(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });
}
