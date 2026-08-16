import { PublishBatchCommand, SNSClient, type SNSClientConfig } from '@aws-sdk/client-sns';
import type { DomainEvent } from '@orgflow/types';

import type { DomainEventPublisher } from './publisher.js';

// SNS caps PublishBatch at ten entries per call.
const SNS_BATCH_LIMIT = 10;

export interface SnsPublisherConfig {
  topicArn: string;
  region: string;
  // Set to the LocalStack container's endpoint for local development;
  // left undefined in a deployed environment so the SDK resolves the real
  // service endpoint itself (matching .env.example's note on
  // ORGFLOW_AWS_ENDPOINT).
  endpoint?: string | undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function createSnsPublisher(config: SnsPublisherConfig): DomainEventPublisher {
  const clientConfig: SNSClientConfig = { region: config.region };
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    // LocalStack accepts any credentials, but the SDK refuses to sign a
    // request without some, and a developer machine will not always have
    // real ones configured.
    clientConfig.credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
  }

  const client = new SNSClient(clientConfig);

  return {
    async publish(events: DomainEvent[]): Promise<void> {
      if (events.length === 0) {
        return;
      }

      for (const batch of chunk(events, SNS_BATCH_LIMIT)) {
        const response = await client.send(
          new PublishBatchCommand({
            TopicArn: config.topicArn,
            PublishBatchRequestEntries: batch.map((event) => ({
              Id: event.eventId,
              Message: JSON.stringify(event),
              MessageAttributes: {
                // Mirrored onto the message so an SNS subscription filter
                // policy can route by type without parsing the body.
                // TECH-STACK.md §6: adding a consumer is a new queue and
                // subscription, not a change to the publisher.
                eventType: { DataType: 'String', StringValue: event.eventType },
                organisationId: { DataType: 'String', StringValue: event.organisationId },
              },
            })),
          }),
        );

        // PublishBatch reports per-entry failures in the response rather
        // than throwing, so a partial failure would otherwise pass
        // silently and lose events.
        if (response.Failed && response.Failed.length > 0) {
          const detail = response.Failed.map(
            (failure) =>
              `${failure.Id ?? 'unknown'}: ${failure.Message ?? failure.Code ?? 'unknown error'}`,
          ).join('; ');
          throw new Error(`SNS rejected ${response.Failed.length} event(s): ${detail}`);
        }
      }
    },
  };
}
