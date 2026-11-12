// Verbindung zum Server
export const API = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? (localStorage.getItem('apiOverride') || 'https://laufcoach-api.janis-rohde.workers.dev')
  : 'https://laufcoach-api.janis-rohde.workers.dev';

const TOKEN_KEY = 'laufcoach_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* egal */ }
}

export class AuthError extends Error {}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth') { setToken(null); throw new AuthError('Bitte neu anmelden.'); }
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}
