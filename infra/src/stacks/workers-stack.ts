import {
  aws_ec2 as ec2,
  aws_lambda as lambda,
  aws_lambda_event_sources as lambda_event_sources,
  aws_lambda_nodejs as lambda_nodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  aws_ses as ses,
  aws_sns as sns,
  aws_sqs as sqs,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

import type { DeploymentEnvironment } from '../config/environment.js';
import { resolveAppEnvName } from '../config/environment.js';

export interface WorkersStackProps extends StackProps {
  environment: DeploymentEnvironment;
  vpc: ec2.IVpc;
  notificationsQueue: sqs.IQueue;
  attachmentScanQueue: sqs.IQueue;
  databaseUrlSecret: secretsmanager.ISecret;
  filesBucket: s3.IBucket;
  domainEventsTopic: sns.ITopic;
}

// TECH-STACK.md §7 and §6 ("workers/ # Lambda handlers"), and PRD.md §20's
// own acceptance criterion for this phase: "the approver receives an email
// via SNS -> SQS -> Lambda -> SES". Unlike ApiStack, nothing here holds a
// connection open across requests the way Express does, so there is no
// persistent-pool argument against Lambda; an SQS event source mapping is
// the AWS-native way to drive an at-least-once queue consumer, and AWS
// itself does the polling workers/src/sqs/consumer.ts's local driver does
// by hand. Recorded as ADR-0019 alongside the ApiStack decision.
export class WorkersStack extends Stack {
  constructor(scope: Construct, id: string, props: WorkersStackProps) {
    super(scope, id, props);

    // PRD.md §14.2's notification emails need a verified sender identity;
    // this is a domain identity because a single mailbox identity would
    // need its own inbox to click a verification link in, which nothing
    // here has. Like databaseUrlSecret and mongoUriSecret in the sibling
    // stacks, this is a placeholder: `environment.sesDomain` is an
    // `.example` address (RFC 2606) until WebStack owns a real, DNS-
    // controlled domain to actually complete SES domain verification
    // against. `cdk synth` produces a valid, complete EmailIdentity
    // resource either way; only real verification needs a real domain.
    const emailIdentity = new ses.EmailIdentity(this, 'EmailIdentity', {
      identity: ses.Identity.domain(props.environment.sesDomain),
    });

    const notificationsLogGroup = new logs.LogGroup(this, 'NotificationsLogGroup', {
      retention: props.environment.isProduction
        ? logs.RetentionDays.SIX_MONTHS
        : logs.RetentionDays.ONE_MONTH,
      removalPolicy: props.environment.isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const notificationsFunction = new lambda_nodejs.NodejsFunction(this, 'NotificationsFunction', {
      // Resolved from this file's own location rather than a path
      // relative to cwd, so `cdk synth` finds it regardless of which
      // directory the CDK CLI was invoked from.
      entry: fileURLToPath(new URL('../../../workers/src/lambda-handler.ts', import.meta.url)),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      // TECH-STACK.md §5.1: ARM64, matching the Graviton instance class
      // DataStack already picked for RDS; ARM64 Lambda is both cheaper and
      // faster for pure Node.js execution with no native addons.
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // Comfortably under the notifications queue's 90-second visibility
      // timeout (MessagingStack), so a message cannot become visible to a
      // second delivery while this invocation is still the one holding it.
      timeout: Duration.seconds(30),
      vpc: props.vpc,
      vpcSubnets: { subnetGroupName: 'app' },
      logGroup: notificationsLogGroup,
      environment: {
        ORGFLOW_ENV: resolveAppEnvName(props.environment.name),
        ORGFLOW_LOG_LEVEL: 'info',
        ORGFLOW_WEB_URL: props.environment.webUrl,
        ORGFLOW_AWS_REGION: props.environment.region,
        ORGFLOW_SES_FROM_ADDRESS: `notifications@${props.environment.sesDomain}`,
        // Not ORGFLOW_DATABASE_URL directly: unlike ECS's `secrets`
        // mapping, a Lambda environment variable sourced from Secrets
        // Manager is resolved into the function's visible configuration at
        // deploy time, which defeats the purpose of keeping it in Secrets
        // Manager at all. The correct pattern is fetching the secret via
        // the SDK inside the handler at cold start; workers/src/
        // lambda-handler.ts does not do that yet; it is a documented
        // follow-up (ADR-0019), and this ARN plus the read grant below are
        // the IAM half of that already in place.
        ORGFLOW_DATABASE_URL_SECRET_ARN: props.databaseUrlSecret.secretArn,
      },
    });

    props.databaseUrlSecret.grantRead(notificationsFunction);

    // Scoped to exactly this identity, not ses:SendEmail on '*': the
    // function can send as notifications@<sesDomain> and nothing else.
    emailIdentity.grantSendEmail(notificationsFunction);

    // reportBatchItemFailures (SQSBatchResponse.batchItemFailures) is what
    // lets lambda-handler.ts report only the records that actually failed;
    // without this flag AWS treats any non-empty return as "retry the
    // whole batch", redelivering messages that already succeeded.
    notificationsFunction.addEventSource(
      new lambda_event_sources.SqsEventSource(props.notificationsQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    // PRD.md §16.1: consumes attachment.uploaded, reads the object from
    // filesBucket, scans it, and publishes attachment.scanned back onto
    // domainEventsTopic. A separate queue and function from notifications
    // (MessagingStack), so a slow or failing scan cannot hold up
    // notification delivery or vice versa.
    const attachmentScanLogGroup = new logs.LogGroup(this, 'AttachmentScanLogGroup', {
      retention: props.environment.isProduction
        ? logs.RetentionDays.SIX_MONTHS
        : logs.RetentionDays.ONE_MONTH,
      removalPolicy: props.environment.isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const attachmentScanFunction = new lambda_nodejs.NodejsFunction(
      this,
      'AttachmentScanFunction',
      {
        entry: fileURLToPath(
          new URL('../../../workers/src/attachment-scan-lambda-handler.ts', import.meta.url),
        ),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        // More headroom than the notifications function's small JSON
        // payloads need: a scan reads the whole attachment into memory
        // (up to MAX_UPLOAD_BYTES, apps/api/src/routes/attachments.ts,
        // 25MB), not just a few KB of event data.
        memorySize: 512,
        // Comfortably under the attachment-scan queue's 90-second
        // visibility timeout (MessagingStack): reading up to 25MB from S3
        // plus a scan needs more headroom than notifications' 30 seconds.
        timeout: Duration.seconds(60),
        vpc: props.vpc,
        vpcSubnets: { subnetGroupName: 'app' },
        logGroup: attachmentScanLogGroup,
        environment: {
          ORGFLOW_ENV: resolveAppEnvName(props.environment.name),
          ORGFLOW_LOG_LEVEL: 'info',
          ORGFLOW_AWS_REGION: props.environment.region,
          ORGFLOW_S3_BUCKET: props.filesBucket.bucketName,
          ORGFLOW_EVENTS_TOPIC_ARN: props.domainEventsTopic.topicArn,
          // Same placeholder pattern as notificationsFunction above, and
          // the same documented follow-up (ADR-0019): the handler does
          // not yet resolve this ARN into a real connection string at
          // cold start.
          ORGFLOW_DATABASE_URL_SECRET_ARN: props.databaseUrlSecret.secretArn,
        },
      },
    );

    props.databaseUrlSecret.grantRead(attachmentScanFunction);
    props.filesBucket.grantReadWrite(attachmentScanFunction);
    props.domainEventsTopic.grantPublish(attachmentScanFunction);

    attachmentScanFunction.addEventSource(
      new lambda_event_sources.SqsEventSource(props.attachmentScanQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
  }
}
