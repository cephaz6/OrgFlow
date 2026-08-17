import { config } from '../config/env';
import { toApiError } from './api-error';

// Browser-side. Relies on the browser to attach the session cookie, which it
// does because the cookie is httpOnly: no script can read it, and none needs
// to. credentials: 'include' is required because the API is a different
// origin from the web application.
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}${path}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
}
