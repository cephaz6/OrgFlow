import { describe, expect, it, vi } from 'vitest';

import { computeBackoffDelayMs, parseDomainEvent } from './consumer.js';

describe('computeBackoffDelayMs', () => {
  it('doubles with each consecutive failure', () => {
    expect(computeBackoffDelayMs(0)).toBe(2000);
    expect(computeBackoffDelayMs(1)).toBe(4000);
    expect(computeBackoffDelayMs(2)).toBe(8000);
    expect(computeBackoffDelayMs(3)).toBe(16_000);
  });

  it('caps at 30 seconds rather than growing forever', () => {
    expect(computeBackoffDelayMs(4)).toBe(30_000);
    expect(computeBackoffDelayMs(5)).toBe(30_000);
    expect(computeBackoffDelayMs(50)).toBe(30_000);
  });
});

describe('parseDomainEvent', () => {
  const logger = { error: vi.fn() } as unknown as Parameters<typeof parseDomainEvent>[1];

  it('returns null for an empty body', () => {
    expect(parseDomainEvent(undefined, logger)).toBeNull();
  });

  it('returns null and logs for a body that is not valid JSON', () => {
    expect(parseDomainEvent('not json', logger)).toBeNull();
  });

  it('returns null and logs for JSON missing the envelope fields', () => {
    expect(parseDomainEvent(JSON.stringify({ hello: 'world' }), logger)).toBeNull();
  });

  it('parses a well-formed domain event', () => {
    const event = {
      eventId: 'event-1',
      eventType: 'attachment.uploaded',
      organisationId: 'org-1',
      occurredAt: new Date().toISOString(),
      actorUserId: null,
      actorType: 'system',
      correlationId: 'corr-1',
      payload: { attachmentId: 'att-1' },
      schemaVersion: 1,
    };

    expect(parseDomainEvent(JSON.stringify(event), logger)).toEqual(event);
  });
});
