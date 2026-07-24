/**
 * Client-side authentication helper.
 *
 * On startup, fetches the passphrase from /api/auth-config (an unauthenticated
 * endpoint). If a passphrase is returned, all subsequent API calls include an
 * "Authorization: Bearer <passphrase>" header.
 */

let cachedPassphrase: string | null | undefined;

/**
 * Fetch the passphrase from the server's auth-config endpoint.
 * Called once on app startup. Result is cached for the session.
 */
export async function initAuth(): Promise<void> {
  try {
    const res = await fetch("/api/auth-config");
    if (res.ok) {
      const data = await res.json();
      cachedPassphrase = data.passphrase || null;
    } else {
      cachedPassphrase = null;
    }
  } catch {
    cachedPassphrase = null;
  }
}

/**
 * Returns the auth headers to merge into fetch options.
 * If no passphrase is configured, returns an empty object.
 */
export function authHeaders(): Record<string, string> {
  if (cachedPassphrase) {
    return { Authorization: `Bearer ${cachedPassphrase}` };
  }
  return {};
}

/**
 * Wrapper around fetch that automatically includes auth headers.
 */
export async function authFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  const auth = authHeaders();
  if (auth.Authorization) {
    headers.Authorization = auth.Authorization;
  }
  return fetch(input, { ...init, headers });
}
