import { NagSuppressions } from 'cdk-nag';

import type { ApiStack } from './stacks/api-stack.js';
import type { DataStack } from './stacks/data-stack.js';
import type { MessagingStack } from './stacks/messaging-stack.js';
import type { NetworkStack } from './stacks/network-stack.js';
import type { WorkersStack } from './stacks/workers-stack.js';

export interface StacksToSuppress {
  network: NetworkStack;
  data: DataStack;
  messaging: MessagingStack;
  api: ApiStack;
  workers: WorkersStack;
}

// Shared between bin/app.ts (the real synth path) and test/stacks.test.ts
// (which exercises the same stacks), so the two never drift out of sync.
// TECH-STACK.md §7 requires every suppression to carry a written
// justification; each one below states why the underlying finding does
// not apply here.
export function applyNagSuppressions(stacks: StacksToSuppress): void {
  const { network, data, api, workers } = stacks;

  NagSuppressions.addResourceSuppressions(
    data.filesBucket,
    [
      {
        id: 'AwsSolutions-S1',
        reason:
          'Server access logging deferred: nothing writes to this bucket yet (the S3 upload/download flow in PRD.md §5.3 is a later phase). Revisit alongside that work rather than standing up a log-destination bucket for a bucket nothing uses.',
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressions(
    data.database,
    [
      {
        id: 'AwsSolutions-RDS3',
        reason:
          'Multi-AZ is enabled for production (DataStack sets multiAz: environment.isProduction); a non-production synth intentionally runs single-AZ to avoid doubling the RDS cost of an environment with no real traffic.',
      },
      {
        id: 'AwsSolutions-RDS10',
        reason:
          'Deletion protection is enabled for production (DataStack sets deletionProtection: environment.isProduction); a non-production environment must stay destroyable via cdk destroy during iteration.',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason:
          'Port obfuscation is not meaningful defence in depth here: the instance sits in an isolated private subnet with no route to the internet, and access control is the security group, not port secrecy. A non-default port would only add friction to every tool and runbook that assumes 5432.',
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressions(
    data.databaseUrlSecret,
    [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          "This secret holds an assembled connection string a person sets by hand after the first deploy (see the comment on DataStack.databaseUrlSecret), not a credential this CDK app issues. Automatic rotation would need a custom resource that recomposes it from the RDS-generated secret alongside that secret's own rotation, which is out of scope for a synth-only skeleton and is recorded as a follow-up in ADR-0019.",
      },
    ],
    true,
  );

  // Known cdk-nag limitation, not a real finding: the auto-created
  // security group on the Secrets Manager VPC interface endpoint has an
  // ingress rule scoped to the VPC's own CIDR block, which CDK resolves as
  // a CloudFormation intrinsic (Fn::GetAtt) rather than a literal string.
  // AwsSolutions-EC23 cannot evaluate a non-literal CIDR and reports a
  // validation failure instead of a pass/fail verdict.
  NagSuppressions.addResourceSuppressions(
    network.vpc,
    [
      {
        id: 'CdkNagValidationFailure',
        reason:
          "AwsSolutions-EC23 cannot evaluate the VPC interface endpoint's security group ingress rule because its CIDR is a CloudFormation intrinsic (the VPC's own CIDR block), not a literal string. The rule itself, scoped to the VPC's own address space, is correct.",
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    api,
    `/${api.stackName}/MongoUriSecret/Resource`,
    [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'Same reasoning as DataStack.databaseUrlSecret: MongoDB Atlas is provisioned outside this CDK app, so there is no resource here for automatic rotation to update. Set and rotated by hand until an Atlas-side rotation integration exists.',
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    api,
    `/${api.stackName}/SessionSecret/Resource`,
    [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'ADR-0010: sessions are not individually revocable, so rotating this secret signs every active user out at once. That is a deliberate operational event, not something to schedule automatically on a timer; it happens when an operator chooses to force a sign-out.',
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    api,
    `/${api.stackName}/TaskDefinition/Resource`,
    [
      {
        id: 'AwsSolutions-ECS2',
        reason:
          "Every value here is genuinely non-secret (log level, port, region, the events topic ARN, the web URL) and the rule's actual concern, a credential in plaintext, does not apply: ORGFLOW_DATABASE_URL, ORGFLOW_MONGODB_URI and ORGFLOW_SESSION_SECRET are the three values that are sensitive, and all three are wired through the container's `secrets` map (ecs.Secret.fromSecretsManager), never `environment`.",
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    api,
    `/${api.stackName}/AlbSecurityGroup/Resource`,
    [
      {
        id: 'AwsSolutions-EC23',
        reason:
          'Deliberate: this is a public-facing load balancer for an HTTP API meant to be reached from the internet. Restricting inbound to a fixed CIDR would defeat the point of the ALB.',
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    api,
    `/${api.stackName}/AlbAccessLogsBucket/Resource`,
    [
      {
        id: 'AwsSolutions-S1',
        reason:
          'This bucket is itself the access-log destination for the load balancer (loadBalancer.logAccessLogs). Enabling S3 server access logging on a log bucket would have it log access to its own logs, which nothing reads and which only inflates storage cost.',
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    api,
    `/${api.stackName}/TaskDefinition/ExecutionRole/DefaultPolicy/Resource`,
    [
      {
        id: 'AwsSolutions-IAM5',
        // Fires only against the real ecr_assets.DockerImageAsset built by
        // bin/app.ts, not test/stacks.test.ts's public-registry stub image,
        // since a public image needs no ECR pull permissions at all.
        appliesTo: ['Resource::*'],
        reason:
          "ecr:GetAuthorizationToken, which CDK grants automatically so the execution role can pull apps/api's image from this account's private ECR: the action has no resource-level permissions, so AWS itself only ever allows it scoped to '*'. The actual pull of a specific image is separately scoped to the ApiImage repository ARN in the same policy.",
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    api,
    `/${api.stackName}/TaskDefinition/TaskRole/DefaultPolicy/Resource`,
    [
      {
        id: 'AwsSolutions-IAM5',
        reason:
          "From domainEventsTopic.grantPublish(taskDefinition.taskRole): publishing to a KMS-encrypted SNS topic requires kms:GenerateDataKey* on the topic's key (MessagingStack's EncryptionKey), which CDK grants automatically. The wildcard is on the action family (GenerateDataKey / GenerateDataKeyWithoutPlaintext), not on the resource: the statement's Resource is the one named key ARN, never '*'.",
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    workers,
    `/${workers.stackName}/NotificationsFunction/Resource`,
    [
      {
        id: 'AwsSolutions-L1',
        reason:
          'NODEJS_22_X is the runtime TECH-STACK.md §5.1 specifies ("Node.js 22 runtime, ARM64"), matching apps/api\'s Dockerfile (node:22-slim) and every package.json engines field in this monorepo. Moving to a newer major the rest of the codebase has not adopted would be a separate, deliberate upgrade, not something to do silently to satisfy this rule.',
      },
    ],
    true,
  );

  NagSuppressions.addResourceSuppressionsByPath(
    workers,
    `/${workers.stackName}/NotificationsFunction/ServiceRole/Resource`,
    [
      {
        id: 'AwsSolutions-IAM4',
        reason:
          "AWSLambdaBasicExecutionRole (CloudWatch Logs) and AWSLambdaVPCAccessExecutionRole (ENI management for VPC attachment) are the two AWS-managed policies CDK attaches automatically to a VPC-attached lambda.Function's default execution role. Both are scoped to exactly what a VPC-attached Lambda's own infrastructure needs; a hand-written equivalent would duplicate what AWS already maintains for its own service integration, not tighten it.",
      },
    ],
    true,
  );
}
