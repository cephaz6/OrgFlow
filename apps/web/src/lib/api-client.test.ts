import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiPost } from './api-client';

// A 204 carries no body, and response.json() on a zero-byte body throws
// "Unexpected end of JSON input". apiPost used to call it unconditionally,
// so "Mark all as read" reported a failure to the user even though the
// request had succeeded and every row was already updated. That is the worst
// shape this bug can take: the side effect happens, and the interface says
// it did not.
describe('apiPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Response): void {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  }

  it('resolves rather than throwing when the response is 204 with no body', async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(apiPost('/notifications/read-all')).resolves.toBeUndefined();
  });

  it('resolves when the body is empty but the status is 200', async () => {
    // Not the documented contract, but it fails identically, and the guard
    // is on what arrived rather than only on the status code.
    stubFetch(new Response('', { status: 200 }));

    await expect(apiPost('/anything')).resolves.toBeUndefined();
  });

  it('still parses and returns a JSON body when there is one', async () => {
    stubFetch(
      new Response(JSON.stringify({ delegation: { delegationId: 'abc' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      apiPost<{ delegation: { delegationId: string } }>('/delegations', {}),
    ).resolves.toEqual({ delegation: { delegationId: 'abc' } });
  });

  it('still throws on a failed request', async () => {
    stubFetch(
      new Response(JSON.stringify({ title: 'Not Found', detail: 'No such thing.' }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    await expect(apiPost('/missing')).rejects.toBeDefined();
  });
});
