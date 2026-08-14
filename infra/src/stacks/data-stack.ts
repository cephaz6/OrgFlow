import {
  aws_ec2 as ec2,
  aws_kms as kms,
  aws_rds as rds,
  aws_s3 as s3,
  Duration,
  RemovalPolicy,
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
    });
    // AwsSolutions-S1 (server access logging): deferred rather than
    // building a dedicated log-destination bucket for a skeleton with no
    // application writing to this bucket yet. Revisit when the S3
    // integration (PRD.md §5.3 presigned upload/download flow) is built.
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
  }
}
