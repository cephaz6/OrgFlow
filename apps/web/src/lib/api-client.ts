import { config } from '../config/env';
import { toApiError } from './api-error';

// Browser-side. Relies on the browser to attach the session cookie, which it
// does because the cookie is httpOnly: no script can read it, and none needs
// to. credentials: 'include' is required because the API is a different
// origin from the web application.
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}${path}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as T;
}

// Unlike apiGet and apiPatch, this tolerates an empty response body. Not
// every POST answers with a resource: marking notifications read, for
// instance, answers 204 with nothing to say, and calling response.json() on
// a zero-byte body throws "Unexpected end of JSON input" rather than
// returning undefined. That surfaced as a failure on "Mark all as read"
// even though the request itself had succeeded and the rows were already
// updated, which is the worst shape a bug of this kind can take.
//
// apiPut's own comment already noted this hazard for 204 routes; apiPost
// simply never applied it. Callers that pass a type argument still receive
// the parsed body, so only the ones that were already discarding the result
// see undefined.
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

  return (await readOptionalJson(response)) as T;
}

// 204 is the contract-level answer, but a 200 with no body would fail the
// same way, so the check is on what actually arrived rather than only on
// the status code.
async function readOptionalJson(response: Response): Promise<unknown> {
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined;
  }

  const text = await response.text();
  return text === '' ? undefined : JSON.parse(text);
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

// Returns nothing, unlike apiPatch: a PUT here replaces a whole resource
// and the routes that accept one answer 204, so parsing a body would throw
// on an empty response.
export async function apiPut(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
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
