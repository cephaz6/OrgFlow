import type { App } from 'aws-cdk-lib';

export type DeploymentEnvironmentName = 'dev' | 'staging' | 'production';

export interface DeploymentEnvironment {
  name: DeploymentEnvironmentName;
  isProduction: boolean;
  // Left undefined for an environment-agnostic synth (no real AWS
  // credentials needed to run `cdk synth`, which is all CI and this
  // skeleton need). Real deployment supplies it via CDK_DEFAULT_ACCOUNT,
  // which the CDK CLI itself populates from the caller's credentials.
  account: string | undefined;
  region: string;
}

// CDK's own analogue of ADR-0001: environment selection is read from CDK
// context, never hard-coded, and read only here. `cdk synth -c env=staging`
// (or cdk.json's default context) selects it. GOV-STANDARDS.md §7 requires
// the AWS region be configurable, defaulting to eu-west-2 (London) for data
// residency; region must be concrete (not a token) so VPC constructs can
// resolve availability zones at synth time.
export function resolveEnvironment(app: App): DeploymentEnvironment {
  const name = app.node.tryGetContext('env') as DeploymentEnvironmentName | undefined;
  if (!name || !['dev', 'staging', 'production'].includes(name)) {
    throw new Error("CDK context 'env' must be one of: dev, staging, production. Pass -c env=dev.");
  }

  const region = (app.node.tryGetContext('region') as string | undefined) ?? 'eu-west-2';

  return {
    name,
    isProduction: name === 'production',
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  };
}
