import {
  aws_cloudwatch as cloudwatch,
  aws_kms as kms,
  aws_scheduler as scheduler,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
  aws_sqs as sqs,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { DeploymentEnvironment } from '../config/environment.js';

export interface MessagingStackProps extends StackProps {
  environment: DeploymentEnvironment;
}

// TECH-STACK.md §6: the API publishes one domain event to this topic;
// each of these subscribes its own queue. Adding a fifth consumer is a
// new queue and subscription here, never a change to whatever publishes
// the event.
const EVENT_CONSUMERS = ['notifications', 'audit', 'analytics', 'webhooks'] as const;

// TECH-STACK.md §7: SNS topics, SQS queues, DLQs, EventBridge schedule
// group.
export class MessagingStack extends Stack {
  public readonly domainEventsTopic: sns.Topic;
  public readonly queues: Record<(typeof EVENT_CONSUMERS)[number], sqs.Queue>;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    const removalPolicy = props.environment.isProduction
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    // A dedicated key for this stack's own resources, not DataStack's: an
    // SNS-to-SQS subscription onto an encrypted queue requires a
    // customer-managed key (AWS rejects it against the AWS-managed
    // alias/aws/sqs key, since SNS cannot be granted publish access to
    // that key's policy), but sharing DataStack's key here would make CDK
    // attach that grant onto the key's own resource policy in DataStack
    // while this stack also depends on DataStack for the key, a
    // cross-stack dependency cycle. A same-stack key sidesteps both.
    const encryptionKey = new kms.Key(this, 'EncryptionKey', {
      enableKeyRotation: true,
      removalPolicy,
    });

    this.domainEventsTopic = new sns.Topic(this, 'DomainEventsTopic', {
      topicName: `orgflow-${props.environment.name}-domain-events`,
      masterKey: encryptionKey,
    });

    this.queues = {} as Record<(typeof EVENT_CONSUMERS)[number], sqs.Queue>;

    for (const consumer of EVENT_CONSUMERS) {
      // GOV-STANDARDS.md §10: every queue gets a DLQ, with an alarm on
      // non-zero depth. The alarm has no action target yet: wiring it to
      // a paging destination is ObservabilityStack's job (TECH-STACK.md
      // §7), not this stack's.
      const deadLetterQueue = new sqs.Queue(this, `${consumer}DeadLetterQueue`, {
        queueName: `orgflow-${props.environment.name}-${consumer}-dlq`,
        encryption: sqs.QueueEncryption.KMS,
        encryptionMasterKey: encryptionKey,
        enforceSSL: true,
        retentionPeriod: Duration.days(14),
        removalPolicy,
      });

      new cloudwatch.Alarm(this, `${consumer}DeadLetterQueueAlarm`, {
        metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
        threshold: 0,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        alarmDescription: `orgflow-${props.environment.name}-${consumer}-dlq has messages`,
      });

      const queue = new sqs.Queue(this, `${consumer}Queue`, {
        queueName: `orgflow-${props.environment.name}-${consumer}`,
        encryption: sqs.QueueEncryption.KMS,
        encryptionMasterKey: encryptionKey,
        enforceSSL: true,
        deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 5 },
        removalPolicy,
      });

      this.domainEventsTopic.addSubscription(new subscriptions.SqsSubscription(queue));
      this.queues[consumer] = queue;
    }

    // TECH-STACK.md §6: SLA timers, one-off schedules created when a task
    // is assigned. Only the group is defined here; individual schedules
    // are created and deleted by the application at runtime, since a
    // schedule's target time is data (when a specific task's SLA expires),
    // not infrastructure.
    new scheduler.CfnScheduleGroup(this, 'SlaTimersScheduleGroup', {
      name: `orgflow-${props.environment.name}-sla-timers`,
    });
  }
}
