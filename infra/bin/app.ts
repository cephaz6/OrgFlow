import { App, Aspects, Tags } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { resolveEnvironment } from '../src/config/environment.js';
import { applyNagSuppressions } from '../src/nag-suppressions.js';
import { DataStack } from '../src/stacks/data-stack.js';
import { MessagingStack } from '../src/stacks/messaging-stack.js';
import { NetworkStack } from '../src/stacks/network-stack.js';

const app = new App();
const environment = resolveEnvironment(app);
const env = { account: environment.account, region: environment.region };

// TECH-STACK.md §7: every stack tagged with project, environment and owner.
Tags.of(app).add('project', 'orgflow');
Tags.of(app).add('environment', environment.name);
Tags.of(app).add('owner', 'orgflow-platform-team');

const network = new NetworkStack(app, `OrgFlow-${environment.name}-Network`, { environment, env });

const data = new DataStack(app, `OrgFlow-${environment.name}-Data`, {
  environment,
  env,
  vpc: network.vpc,
});

new MessagingStack(app, `OrgFlow-${environment.name}-Messaging`, {
  environment,
  env,
});

// TECH-STACK.md §7: cdk-nag with AWS Solutions rules; PRD.md §20 requires
// cdk synth to succeed with zero unsuppressed findings.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
applyNagSuppressions(network, data);
