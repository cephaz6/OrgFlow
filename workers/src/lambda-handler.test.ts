import type { DomainEvent } from '@orgflow/types';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// dispatchDomainEvent is mocked so this file never opens a real database
// connection; resolveDeps still constructs a real pg.Pool (a lazy config
// object, not a connection attempt) and a dummy email sender, both cheap
// and inert until something actually queries or sends through them.
const dispatchDomainEvent = vi.fn<(deps: unknown, event: DomainEvent) => Promise<unknown>>();
vi.mock('./notifications/dispatch.js', () => ({ dispatchDomainEvent }));

const REQUIRED_ENV = {
  ORGFLOW_ENV: 'local',
  // Not 'silent': the config schema's enum only allows pino's named
  // levels, not that special value.
  ORGFLOW_LOG_LEVEL: 'fatal',
  ORGFLOW_DATABASE_URL: 'postgres://user:pass@localhost:5432/orgflow',
  ORGFLOW_WEB_URL: 'http://localhost:3000',
  ORGFLOW_AWS_REGION: 'eu-west-2',
};

function domainEventBody(overrides: Partial<DomainEvent> = {}): string {
  return JSON.stringify({
    eventId: '01a008a3-1e3e-75c7-ac9e-0be1e8c853a5',
    eventType: 'task.created',
    organisationId: '01a008a3-1e3e-75c7-ac9e-0be1e8c853a0',
    occurredAt: '2026-08-18T09:00:00.000Z',
    payload: {},
    ...overrides,
  });
}

// The SQSRecord shape @types/aws-lambda requires, with everything the
// handler itself never reads filled in with plausible defaults.
function sqsRecord(messageId: string, body: string): SQSRecord {
  return {
    messageId,
    receiptHandle: `receipt-${messageId}`,
    body,
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '0',
      SenderId: 'test',
      ApproximateFirstReceiveTimestamp: '0',
    },
    messageAttributes: {},
    md5OfBody: 'ignored',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-west-2:000000000000:orgflow-dev-notifications',
    awsRegion: 'eu-west-2',
  };
}

describe('lambda-handler', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(key, value);
    }
    dispatchDomainEvent.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // The first dynamic import in this file loads the handler's whole
  // dependency graph, @orgflow/db included, which costs seconds rather than
  // milliseconds. It has to be dynamic and inside a test, because the
  // config module validates the environment at import time and beforeEach
  // is what stubs it. Against the 5s default that left almost no headroom:
  // under `turbo run test`, with other packages building and testing
  // alongside, it tipped over, and the timeout then surfaced twice, once
  // here and once as a confusing off-by-one in the next test, because the
  // late import consumed one of its mockResolvedValueOnce values.
  // Subsequent imports hit the module cache, so only this one needs the
  // allowance.
  it('reports no failures when every record dispatches cleanly', async () => {
    dispatchDomainEvent.mockResolvedValue({ handled: true });
    const { handler } = await import('./lambda-handler.js');

    const event: SQSEvent = { Records: [sqsRecord('msg-1', domainEventBody())] };
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(dispatchDomainEvent).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('reports only the record whose handler threw, not the whole batch', async () => {
    // The property that matters: reportBatchItemFailures means one bad
    // message does not force AWS to redeliver messages that already
    // succeeded, which a plain all-or-nothing batch failure would do.
    dispatchDomainEvent
      .mockResolvedValueOnce({ handled: true })
      .mockRejectedValueOnce(new Error('SES throttled'))
      .mockResolvedValueOnce({ handled: true });

    const { handler } = await import('./lambda-handler.js');

    const event: SQSEvent = {
      Records: [
        sqsRecord('msg-ok-1', domainEventBody({ eventId: 'event-1' })),
        sqsRecord('msg-fails', domainEventBody({ eventId: 'event-2' })),
        sqsRecord('msg-ok-2', domainEventBody({ eventId: 'event-3' })),
      ],
    };

    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-fails' }]);
  });

  it('drops an unparseable message without reporting it as a failure', async () => {
    // Mirrors pollOnce: a body that is not a domain event envelope will
    // never parse no matter how many times it is redelivered, so it is
    // treated as handled rather than retried forever.
    const { handler } = await import('./lambda-handler.js');

    const event: SQSEvent = { Records: [sqsRecord('msg-bad', 'not json at all')] };
    const result = await handler(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(dispatchDomainEvent).not.toHaveBeenCalled();
  });

  it('processes an empty batch without error', async () => {
    const { handler } = await import('./lambda-handler.js');

    const result = await handler({ Records: [] });

    expect(result.batchItemFailures).toEqual([]);
  });
});
