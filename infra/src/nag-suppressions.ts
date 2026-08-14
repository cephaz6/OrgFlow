import { NagSuppressions } from 'cdk-nag';

import type { DataStack } from './stacks/data-stack.js';
import type { NetworkStack } from './stacks/network-stack.js';

// Shared between bin/app.ts (the real synth path) and test/stacks.test.ts
// (which exercises the same stacks), so the two never drift out of sync.
// TECH-STACK.md §7 requires every suppression to carry a written
// justification; each one below states why the underlying finding does
// not apply here.
export function applyNagSuppressions(network: NetworkStack, data: DataStack): void {
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
}
