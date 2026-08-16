import type { App } from 'aws-cdk-lib';

// apps/api's own ORGFLOW_ENV enum ('local' | 'development' | 'staging' |
// 'production') is not the same set as this one: 'local' has no
// deployment-environment counterpart, and CDK's 'dev' is spelled
// 'development' there. Kept as two separate enums rather than unified,
// because unifying them would mean either teaching the application about
// CDK's naming or teaching CDK about a 'local' it can never deploy to;
// resolveAppEnvName below is the one place that translates between them.
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
  // Placeholder values, not live configuration. WebStack (TECH-STACK.md
  // §7) is what will eventually own a real domain, CloudFront distribution
  // and ACM certificate; until it exists, ApiStack and WorkersStack still
  // need *some* concrete string to put in a CORS origin, a notification
  // link and an SES identity so `cdk synth` produces a complete template.
  // `.example` is IANA-reserved for exactly this (RFC 2606): a domain
  // nobody can ever actually register, so it can never collide with a
  // mistake once a real one is wired in.
  webUrl: string;
  sesDomain: string;
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
  const sesDomain = `orgflow-${name}.example`;

  return {
    name,
    isProduction: name === 'production',
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
    webUrl: `https://app.${sesDomain}`,
    sesDomain,
  };
}

// apps/api/src/config/env.ts's ORGFLOW_ENV enum, translated from this
// module's DeploymentEnvironmentName. 'local' is deliberately unreachable
// here: it is what enables /auth/dev-login (ADR-0002), and nothing this
// module deploys should ever be able to select it.
export function resolveAppEnvName(
  name: DeploymentEnvironmentName,
): 'development' | 'staging' | 'production' {
  return name === 'dev' ? 'development' : name;
}
