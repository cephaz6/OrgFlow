import {
  aws_ec2 as ec2,
  aws_logs as logs,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { DeploymentEnvironment } from '../config/environment.js';

export interface NetworkStackProps extends StackProps {
  environment: DeploymentEnvironment;
}

// TECH-STACK.md §7: VPC, subnets, security groups, VPC endpoints.
export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    // This is the "later phase" the previous comment here anticipated:
    // ApiStack's Fargate tasks and WorkersStack's Lambda both need outbound
    // internet access that RDS never did. MongoDB Atlas is the definition
    // store's actual deployment target (TECH-STACK.md §5.2: "DocumentDB is
    // an option... but is not API-complete. That is noted as a constraint,
    // not a plan."), meaning it lives outside the VPC entirely, and the
    // Google OIDC discovery endpoint apps/api calls at boot is likewise
    // reached over the public internet. Neither has a VPC endpoint, so a
    // NAT gateway is the only route to either that keeps compute out of a
    // public subnet.
    //
    // One NAT gateway rather than one per AZ: this skeleton is not
    // deployed, and a single NAT is the standard non-production cost
    // tradeoff. A production environment reads this same line; revisit
    // alongside WebStack, when real traffic makes AZ-level NAT redundancy
    // (surviving one AZ's NAT gateway failing) worth its second hourly
    // charge.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        // Fargate tasks and the notification Lambda: outbound internet via
        // the NAT gateway above, no direct inbound route from the internet.
        {
          name: 'app',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // AwsSolutions-VPC7: a VPC must publish flow logs.
    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, 'FlowLogGroup', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: props.environment.isProduction
            ? RemovalPolicy.RETAIN
            : RemovalPolicy.DESTROY,
        }),
      ),
    });

    // Free: routes S3 traffic (attachments, exports) over the AWS network
    // instead of the public internet, without an hourly endpoint charge.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // RDS's generated-secret credentials live in Secrets Manager; anything
    // in the VPC that needs to read them (migrations, future compute)
    // reaches it without leaving the VPC.
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });
  }
}
