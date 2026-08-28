import {
  aws_ec2 as ec2,
  aws_kms as kms,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { DeploymentEnvironment } from '../config/environment.js';

export interface DataStackProps extends StackProps {
  environment: DeploymentEnvironment;
  vpc: ec2.IVpc;
}

// TECH-STACK.md §7: RDS Postgres, S3 buckets, KMS keys, Secrets Manager.
export class DataStack extends Stack {
  public readonly encryptionKey: kms.Key;
  public readonly database: rds.DatabaseInstance;
  public readonly filesBucket: s3.Bucket;
  // A placeholder, not a real credential: RDS's own generated secret above
  // holds the real, rotating username and password, reachable only by
  // rotation and by whatever composes a connection string from it.
  // ApiStack and WorkersStack both need one *assembled* ORGFLOW_DATABASE_URL
  // string (host, port, credentials and database name together), and
  // CloudFormation has no built-in way to concatenate one secret's fields
  // into another's value without either embedding the password in the
  // template (which CDK's own docs warn against) or a custom resource this
  // synth-only skeleton does not yet need. The pragmatic middle ground: an
  // empty secret whose real value is set once, by hand, the first time this
  // stack is actually deployed, exactly like ORGFLOW_MONGODB_URI already
  // has to be (Atlas is not infra-managed either). Composing and rotating
  // it automatically alongside RDS's own rotation is a real improvement,
  // documented as a follow-up rather than built here.
  public readonly databaseUrlSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const removalPolicy = props.environment.isProduction
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    // GOV-STANDARDS.md §7: AES-256 at rest across RDS and S3. One
    // customer-managed key for both, rather than a key each: nothing here
    // needs separately revocable access between the two yet, and a single
    // key is one less thing to rotate and audit. AwsSolutions-KMS5 requires
    // rotation.
    this.encryptionKey = new kms.Key(this, 'EncryptionKey', {
      enableKeyRotation: true,
      removalPolicy,
    });

    // PRD.md §5.3: case attachments, generated exports, organisation
    // branding assets, keyed {organisationId}/cases/{caseId}/....
    this.filesBucket = new s3.Bucket(this, 'FilesBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: !props.environment.isProduction,
      lifecycleRules: [
        {
          id: 'expire-noncurrent-versions',
          noncurrentVersionExpiration: Duration.days(90),
        },
      ],
      // PRD.md §16.1: the browser uploads directly to this bucket via a
      // presigned POST, which is a cross-origin request from the web
      // app's own domain (never from a script running inside this
      // bucket's own origin, since it is never served as a website).
      // GET is for a presigned download the same way; nothing else needs
      // to reach this bucket from a browser.
      cors: [
        {
          allowedOrigins: [props.environment.webUrl],
          allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedHeaders: ['*'],
        },
      ],
    });
    // AwsSolutions-S1 (server access logging): still deferred, now that
    // the bucket has real traffic (ApiStack presigns and confirms,
    // WorkersStack's scan function reads and quarantines). GOV-STANDARDS.md's
    // audit requirement for a download is already met at the application
    // layer (an audit event on every GET /attachments/:id/download,
    // packages/db's audit_events table), which is the thing PRD.md §16.2
    // actually asks for; S3's own request-level access log is a separate,
    // lower-level AWS audit trail, and building its dedicated
    // log-destination bucket is real, scoped follow-up work, not something
    // to rush in alongside wiring the bucket up for the first time.
    // Reason recorded per TECH-STACK.md §7's suppression requirement; the
    // actual cdk-nag suppression call sits in bin/app.ts, next to the
    // AwsSolutionsChecks aspect it applies to.

    // Owned here rather than in NetworkStack: this stack (and its own
    // features, such as the rotation Lambda below) is what needs to keep
    // adding ingress rules to it over time, e.g. addRotationSingleUser()
    // adds one for the rotation Lambda. A security group whose rules are
    // defined in a different stack from the resource that keeps extending
    // it produces cross-stack dependency cycles the moment that resource
    // adds one referencing the security group's own protected resource.
    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: props.vpc,
      description: 'OrgFlow Postgres (RDS).',
      allowAllOutbound: false,
    });

    // TECH-STACK.md §5.1: RDS PostgreSQL 16, db.t4g.micro for development.
    this.database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MICRO,
      ),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      // credentials live only in the generated Secrets Manager secret;
      // nothing in the codebase ever carries a real database password.
      credentials: rds.Credentials.fromGeneratedSecret('orgflow_app'),
      databaseName: 'orgflow',
      storageEncrypted: true,
      storageEncryptionKey: this.encryptionKey,
      multiAz: props.environment.isProduction,
      // GOV-STANDARDS.md §10: back up Postgres with point-in-time
      // recovery; PRD.md §14 specifies a 7-day window.
      backupRetention: Duration.days(7),
      deletionProtection: props.environment.isProduction,
      removalPolicy,
    });

    // AwsSolutions-SMG4: the generated credentials secret must rotate.
    // Uses RDS's own hosted rotation Lambda (no custom rotation code to
    // maintain); it reaches Secrets Manager through the VPC interface
    // endpoint NetworkStack already sets up, so it never needs internet
    // egress.
    this.database.addRotationSingleUser({ automaticallyAfter: Duration.days(30) });

    // ApiStack's Fargate tasks and WorkersStack's Lambda both need to reach
    // Postgres, and both live in NetworkStack's 'app' subnet group. Scoped
    // by that subnet group's CIDR blocks rather than by security group
    // reference: DataStack is built before either of those stacks exists,
    // and a security-group-to-security-group rule would need ApiStack's SG
    // as an input, making DataStack depend on a stack that itself depends
    // on DataStack for the database endpoint. A CIDR-based rule needs
    // nothing back from either stack, so the dependency stays one-directional.
    for (const subnet of props.vpc.selectSubnets({ subnetGroupName: 'app' }).subnets) {
      databaseSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(subnet.ipv4CidrBlock),
        ec2.Port.tcp(5432),
        `Postgres from the app subnet in ${subnet.availabilityZone}`,
      );
    }

    // No encryptionKey: this.encryptionKey here, deliberately, matching
    // rds.Credentials.fromGeneratedSecret above, which likewise never
    // passes one. A secret on this stack's own customer-managed key would
    // need its key's resource policy to name whichever role in ApiStack or
    // WorkersStack reads it, and DataStack is built before either of those
    // stacks exists; that reference would make DataStack depend on a stack
    // that already depends on DataStack for this very secret, the same
    // cyclic shape MessagingStack's own EncryptionKey comment describes.
    // The default AWS-managed secretsmanager key carries no such policy to
    // update, so granting a role in a different stack read access needs
    // nothing back from that stack.
    this.databaseUrlSecret = new secretsmanager.Secret(this, 'DatabaseUrlSecret', {
      description:
        'ORGFLOW_DATABASE_URL for apps/api and workers. Placeholder: set the real ' +
        'postgres://user:pass@host:port/dbname value after the first deploy, once the ' +
        "database's generated credentials secret exists to compose it from.",
      secretStringValue: SecretValue.unsafePlainText('postgres://replace-me-after-deploy'),
      removalPolicy,
    });
  }
}
