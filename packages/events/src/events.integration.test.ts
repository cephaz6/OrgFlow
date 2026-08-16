import {
  CreateTopicCommand,
  SNSClient,
  SubscribeCommand,
  DeleteTopicCommand,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import type { DomainEvent } from '@orgflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDummyPublisher } from './dummy-publisher.js';
import { createSnsPublisher } from './sns-publisher.js';

// Phase 1's point is proving the real fan-out topology, so this publishes
// to a real SNS topic and reads the message back off a real subscribed SQS
// queue rather than asserting against a stub. The endpoint comes from the
// LocalStack container src/test/global-setup.ts starts.
const REGION = 'eu-west-2';
const CREDENTIALS = { accessKeyId: 'test', secretAccessKey: 'test' };

function domainEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: `event-${Math.random().toString(36).slice(2)}`,
    eventType: 'case.submitted',
    organisationId: '00000000-0000-0000-0000-00000000000a',
    occurredAt: '2026-08-14T12:00:00.000Z',
    actorUserId: '00000000-0000-0000-0000-000000000001',
    actorType: 'user',
    correlationId: 'integration-test',
    payload: { caseId: '00000000-0000-0000-0000-0000000000dd' },
    schemaVersion: 1,
    ...overrides,
  };
}

describe('the dummy publisher', () => {
  it('records what it was asked to publish', async () => {
    const publisher = createDummyPublisher();
    const event = domainEvent();

    await publisher.publish([event]);
    expect(publisher.published).toEqual([event]);

    publisher.clear();
    expect(publisher.published).toEqual([]);
  });

  it('accepts an empty batch without complaint', async () => {
    const publisher = createDummyPublisher();
    await publisher.publish([]);
    expect(publisher.published).toEqual([]);
  });
});

describe('the SNS publisher against LocalStack', () => {
  let ENDPOINT: string;
  let sns: SNSClient;
  let sqs: SQSClient;
  let topicArn: string;
  let queueUrl: string;

  beforeAll(async () => {
    ENDPOINT = process.env.ORGFLOW_TEST_AWS_ENDPOINT!;
    sns = new SNSClient({ region: REGION, endpoint: ENDPOINT, credentials: CREDENTIALS });
    sqs = new SQSClient({ region: REGION, endpoint: ENDPOINT, credentials: CREDENTIALS });

    const topic = await sns.send(new CreateTopicCommand({ Name: 'orgflow-test-domain-events' }));
    topicArn = topic.TopicArn!;

    const queue = await sqs.send(new CreateQueueCommand({ QueueName: 'orgflow-test-consumer' }));
    queueUrl = queue.QueueUrl!;

    const attributes = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
    );
    const queueArn = attributes.Attributes!.QueueArn!;

    // The queue must allow SNS to deliver to it, exactly as the CDK
    // MessagingStack's SqsSubscription arranges in a deployed environment.
    await sqs.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: {
          Policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'sns.amazonaws.com' },
                Action: 'sqs:SendMessage',
                Resource: queueArn,
                Condition: { ArnEquals: { 'aws:SourceArn': topicArn } },
              },
            ],
          }),
        },
      }),
    );

    await sns.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'sqs',
        Endpoint: queueArn,
        Attributes: { RawMessageDelivery: 'true' },
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
    await sns.send(new DeleteTopicCommand({ TopicArn: topicArn })).catch(() => undefined);
  });

  async function receive(expected: number): Promise<DomainEvent[]> {
    const collected: DomainEvent[] = [];

    // SQS long-polls; a couple of rounds covers SNS's delivery latency.
    for (let attempt = 0; attempt < 5 && collected.length < expected; attempt += 1) {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 2,
        }),
      );
      for (const message of response.Messages ?? []) {
        collected.push(JSON.parse(message.Body!) as DomainEvent);
      }
    }

    return collected;
  }

  it('delivers a published event through SNS to a subscribed SQS queue', async () => {
    const publisher = createSnsPublisher({ topicArn, region: REGION, endpoint: ENDPOINT });
    const event = domainEvent();

    await publisher.publish([event]);

    const received = await receive(1);
    expect(received).toHaveLength(1);
    // The envelope must survive the round trip intact: consumers re-assert
    // tenancy on organisationId and dedupe on eventId (PRD.md §10).
    expect(received[0]).toEqual(event);
  });

  it('publishes a batch larger than the SNS ten-entry limit', async () => {
    const publisher = createSnsPublisher({ topicArn, region: REGION, endpoint: ENDPOINT });
    const events = Array.from({ length: 12 }, (_, index) =>
      domainEvent({ eventId: `batch-event-${index}` }),
    );

    await publisher.publish(events);

    const received = await receive(12);
    expect(received).toHaveLength(12);
    expect(new Set(received.map((event) => event.eventId)).size).toBe(12);
  });

  it('does not call SNS at all for an empty batch', async () => {
    const publisher = createSnsPublisher({
      // A topic ARN that does not exist: reaching SNS would fail loudly,
      // so this passing proves the empty case short-circuits.
      topicArn: 'arn:aws:sns:eu-west-2:000000000000:does-not-exist',
      region: REGION,
      endpoint: ENDPOINT,
    });

    await expect(publisher.publish([])).resolves.toBeUndefined();
  });
});
