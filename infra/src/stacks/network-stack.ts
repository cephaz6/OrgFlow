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

    // No NAT gateway: nothing in this skeleton needs outbound internet
    // access from a private subnet. RDS lives in the isolated subnets;
    // AWS service access from within the VPC goes through the endpoints
    // below instead of a NAT gateway's recurring hourly cost. A later
    // phase adding Lambda workers that need outbound internet access adds
    // a NAT gateway (or more endpoints) then, not speculatively now.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
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
