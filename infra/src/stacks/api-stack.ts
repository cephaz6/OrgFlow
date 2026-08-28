import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  aws_sns as sns,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { DeploymentEnvironment } from '../config/environment.js';
import { resolveAppEnvName } from '../config/environment.js';

export interface ApiStackProps extends StackProps {
  environment: DeploymentEnvironment;
  vpc: ec2.IVpc;
  databaseUrlSecret: secretsmanager.ISecret;
  domainEventsTopic: sns.ITopic;
  filesBucket: s3.IBucket;
  // Injected rather than built here, so a fast, offline `pnpm test` never
  // has to invoke `docker build`. bin/app.ts's real synth path passes a
  // DockerImageAsset built from apps/api/Dockerfile; test/stacks.test.ts
  // passes a tiny public-registry image instead, since cdk-nag and the
  // snapshot only need a syntactically valid image reference, never one
  // that could actually serve traffic.
  apiImage: ecs.ContainerImage;
}

const CONTAINER_PORT = 4000;

// TECH-STACK.md §7: ECS Fargate, the alternative it names alongside Lambda
// for API compute. Chosen over Lambda because apps/api/src/index.ts already
// is a long-running Express process that opens its Postgres pool and Mongo
// client once at startup and holds them for the process lifetime; wrapping
// that in a Lambda handler would either force a rewrite of already-tested
// server bootstrap code or reopen a fresh connection pool on every cold
// start, the opposite of what a persistent pool is for. Recorded as
// ADR-0019.
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const removalPolicy = props.environment.isProduction
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // Neither secret below passes an encryptionKey, on purpose, and not
    // only for consistency with DataStack.databaseUrlSecret: the execution
    // role that reads them belongs to this same stack's TaskDefinition, so
    // there is no cross-stack grant to worry about for either. What still
    // rules out DataStack's customer-managed key is where the *key* lives,
    // not where the *secret* or the *grantee* does: a key owned by
    // DataStack would need its resource policy to name a role in this
    // stack, and this stack already depends on DataStack for the VPC and
    // the database, so that back-reference is the cyclic shape
    // MessagingStack's own EncryptionKey comment warns about. The default
    // AWS-managed secretsmanager key sidesteps it entirely.

    // MongoDB Atlas is not infra-managed (TECH-STACK.md §5.2), so there is
    // no resource here to compose this from; the real connection string is
    // set by hand after the first deploy, the same way databaseUrlSecret is.
    const mongoUriSecret = new secretsmanager.Secret(this, 'MongoUriSecret', {
      description:
        'ORGFLOW_MONGODB_URI. Placeholder: MongoDB Atlas is provisioned outside this ' +
        'CDK app, so there is nothing to generate this from. Set the real connection ' +
        'string by hand once an Atlas cluster exists for this environment.',
      secretStringValue: SecretValue.unsafePlainText('mongodb+srv://replace-me-after-deploy'),
      removalPolicy,
    });

    // ADR-0010: a real, unpredictable value, generated once and never
    // transcribed by a person, unlike the two secrets above that describe
    // resources this CDK app does not own.
    const sessionSecret = new secretsmanager.Secret(this, 'SessionSecret', {
      description: 'ORGFLOW_SESSION_SECRET: signs and encrypts the session cookie (ADR-0010).',
      generateSecretString: { passwordLength: 64, excludeCharacters: '"\'\\@/' },
      removalPolicy,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    const logGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      retention: props.environment.isProduction
        ? logs.RetentionDays.SIX_MONTHS
        : logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });

    taskDefinition.addContainer('api', {
      image: props.apiImage,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup }),
      portMappings: [{ containerPort: CONTAINER_PORT }],
      environment: {
        // ADR-0001: every ORGFLOW_ value the container sees, plain or
        // secret, is supplied here at deploy time; nothing is baked into
        // the image (Dockerfile records the same rule).
        ORGFLOW_ENV: resolveAppEnvName(props.environment.name),
        ORGFLOW_API_PORT: String(CONTAINER_PORT),
        ORGFLOW_LOG_LEVEL: 'info',
        ORGFLOW_WEB_URL: props.environment.webUrl,
        ORGFLOW_AWS_REGION: props.environment.region,
        // Left unset deliberately: apps/api/src/config/env.ts treats a
        // blank ORGFLOW_AWS_ENDPOINT as "use the real AWS service
        // endpoints", which is exactly correct once deployed. Setting it
        // here would point a real environment at LocalStack.
        ORGFLOW_EVENTS_TOPIC_ARN: props.domainEventsTopic.topicArn,
        ORGFLOW_S3_BUCKET: props.filesBucket.bucketName,
      },
      secrets: {
        // CDK auto-grants the task's execution role read access to each of
        // these three secrets; no explicit IAM call needed for them.
        ORGFLOW_DATABASE_URL: ecs.Secret.fromSecretsManager(props.databaseUrlSecret),
        ORGFLOW_MONGODB_URI: ecs.Secret.fromSecretsManager(mongoUriSecret),
        ORGFLOW_SESSION_SECRET: ecs.Secret.fromSecretsManager(sessionSecret),
      },
    });

    // The runtime IAM permissions the application code itself needs,
    // distinct from the execution role's image-pull and secret-read
    // permissions above: publishing a domain event (ADR-0008's SNS
    // publisher) after a case transitions, and presigning, confirming,
    // downloading and soft-deleting an attachment (PRD.md §16.1) against
    // the real object store.
    props.domainEventsTopic.grantPublish(taskDefinition.taskRole);
    props.filesBucket.grantReadWrite(taskDefinition.taskRole);

    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc: props.vpc,
      description: 'OrgFlow API (Fargate tasks).',
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      vpcSubnets: { subnetGroupName: 'app' },
      securityGroups: [serviceSecurityGroup],
      desiredCount: props.environment.isProduction ? 2 : 1,
      // A single-task non-production service has no second task to stay
      // healthy while the first is replaced, so 100% would block every
      // deployment; production keeps the usual zero-downtime guarantee.
      minHealthyPercent: props.environment.isProduction ? 100 : 0,
      // Without this, a task that fails to start repeatedly is retried for
      // up to three hours before ECS gives up, rather than failing fast
      // and rolling the service back to the last good task definition.
      circuitBreaker: { rollback: true },
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: props.vpc,
      description: 'OrgFlow API load balancer.',
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Public HTTP');
    serviceSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(CONTAINER_PORT),
      'From the load balancer only',
    );

    const accessLogsBucket = new s3.Bucket(this, 'AlbAccessLogsBucket', {
      // ALB access log delivery does not support SSE-KMS (AWS-documented
      // limitation), only the bucket default of SSE-S3, so this cannot
      // share DataStack's KMS-encrypted bucket or key.
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !props.environment.isProduction,
      lifecycleRules: [{ id: 'expire-access-logs', expiration: Duration.days(90) }],
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: props.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSecurityGroup,
    });
    loadBalancer.logAccessLogs(accessLogsBucket);

    // HTTP only: an HTTPS listener needs an ACM certificate, which needs a
    // real, DNS-validated domain. WebStack (TECH-STACK.md §7) is what will
    // own that domain; this listener moves to 443 alongside it rather than
    // synthesising a certificate this skeleton has no hostname to validate.
    const listener = loadBalancer.addListener('Listener', { port: 80, open: false });
    listener.addTargets('ApiTargets', {
      port: CONTAINER_PORT,
      // 4000 is not one of the ports CDK infers a protocol for (80, 443);
      // stated explicitly rather than relying on that inference.
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: { path: '/health', healthyHttpCodes: '200' },
    });
  }
}
