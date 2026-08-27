import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import type { DomainEvent } from '@orgflow/types';

import type { Logger } from '../logger.js';

export interface ConsumerConfig {
  queueUrl: string;
  region: string;
  endpoint?: string | undefined;
  // Long polling: one call waits up to this long for a message rather than
  // returning empty immediately, which is both cheaper and lower latency
  // than a tight poll loop.
  waitTimeSeconds?: number;
  maxMessages?: number;
}

export function createSqsClient(config: Pick<ConsumerConfig, 'region' | 'endpoint'>): SQSClient {
  return new SQSClient({
    region: config.region,
    ...(config.endpoint
      ? {
          endpoint: config.endpoint,
          credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        }
      : {}),
  });
}

// The SNS subscription uses raw message delivery, so the body is the
// DomainEvent itself rather than an SNS envelope wrapping it. A body that
// does not parse, or parses to something without the envelope fields
// PRD.md §10 defines, is not a transient failure: retrying it would fail
// identically forever, so it is dropped with a loud log rather than
// occupying the queue until the redrive policy dead-letters it.
export function parseDomainEvent(body: string | undefined, logger: Logger): DomainEvent | null {
  if (!body) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    logger.error({ body: body.slice(0, 500) }, 'queue message body was not valid JSON; dropping');
    return null;
  }

  const candidate = parsed as Partial<DomainEvent>;
  if (
    typeof candidate.eventId !== 'string' ||
    typeof candidate.eventType !== 'string' ||
    typeof candidate.organisationId !== 'string'
  ) {
    logger.error(
      { keys: Object.keys(candidate ?? {}) },
      'queue message was not a domain event envelope; dropping',
    );
    return null;
  }

  return candidate as DomainEvent;
}

export interface PollResult {
  received: number;
  processed: number;
  failed: number;
}

// One polling cycle: receive, handle, delete. A message is deleted only
// after its handler resolves, so a handler that throws leaves the message on
// the queue to become visible again after the visibility timeout and be
// retried, and eventually dead-lettered by the queue's redrive policy. That
// retry is safe precisely because the handler is idempotent on eventId
// (PRD.md §10 and §14.2).
export async function pollOnce(
  client: SQSClient,
  config: ConsumerConfig,
  handle: (event: DomainEvent) => Promise<unknown>,
  logger: Logger,
): Promise<PollResult> {
  const response = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: config.queueUrl,
      MaxNumberOfMessages: config.maxMessages ?? 10,
      WaitTimeSeconds: config.waitTimeSeconds ?? 5,
    }),
  );

  const messages: Message[] = response.Messages ?? [];
  let processed = 0;
  let failed = 0;

  for (const message of messages) {
    const event = parseDomainEvent(message.Body, logger);

    if (!event) {
      // Unparseable, so retrying cannot help. Delete it rather than let it
      // cycle until the redrive policy gives up.
      await deleteMessage(client, config.queueUrl, message);
      continue;
    }

    try {
      await handle(event);
      await deleteMessage(client, config.queueUrl, message);
      processed += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err, eventId: event.eventId, eventType: event.eventType },
        'handler failed; leaving the message on the queue for redelivery',
      );
    }
  }

  return { received: messages.length, processed, failed };
}

async function deleteMessage(client: SQSClient, queueUrl: string, message: Message): Promise<void> {
  if (message.ReceiptHandle) {
    await client.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
    );
  }
}

const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30_000;

// Exponential, capped: a receive failure right after one success waits
// briefly, in case it was momentary (a network blip, a throttle), but one
// that keeps failing backs off up to BACKOFF_MAX_MS rather than hammering
// the queue, or AWS itself, at a flat interval forever. Exported so the
// shape of the ramp can be asserted directly, without needing a real SQS
// failure to spin the loop for it.
export function computeBackoffDelayMs(consecutiveFailures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** consecutiveFailures, BACKOFF_MAX_MS);
}

// The local development driver. In a deployed environment the same handler
// runs behind a Lambda event-source mapping (TECH-STACK.md §6), which is
// the deployment step's job; nothing about the handler changes, only what
// pulls messages off the queue.
export async function runConsumer(
  client: SQSClient,
  config: ConsumerConfig,
  handle: (event: DomainEvent) => Promise<unknown>,
  logger: Logger,
  shouldContinue: () => boolean = () => true,
): Promise<void> {
  logger.info({ queueUrl: config.queueUrl }, 'notification consumer polling');
  let consecutiveFailures = 0;

  while (shouldContinue()) {
    try {
      const result = await pollOnce(client, config, handle, logger);
      consecutiveFailures = 0;
      if (result.received > 0) {
        logger.info(result, 'poll cycle complete');
      }
    } catch (err) {
      // A receive failure is infrastructure, not a poison message. Log and
      // keep polling rather than exiting the process, but back off first:
      // a queue that does not exist, or an AWS outage, fails identically
      // on every attempt, and retrying it every 2 seconds forever produces
      // nothing but a continuous stream of identical stack traces.
      const delayMs = computeBackoffDelayMs(consecutiveFailures);
      consecutiveFailures += 1;
      logger.error(
        { err, delayMs, consecutiveFailures },
        'failed to poll the queue; backing off before retrying',
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
