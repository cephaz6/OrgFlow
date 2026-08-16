import {
  App,
  aws_ecr_assets as ecr_assets,
  aws_ecs as ecs,
  Aspects,
  Stack,
  Tags,
} from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { fileURLToPath } from 'node:url';

import { resolveEnvironment } from '../src/config/environment.js';
import { applyNagSuppressions } from '../src/nag-suppressions.js';
import { ApiStack } from '../src/stacks/api-stack.js';
import { DataStack } from '../src/stacks/data-stack.js';
import { MessagingStack } from '../src/stacks/messaging-stack.js';
import { NetworkStack } from '../src/stacks/network-stack.js';
import { WorkersStack } from '../src/stacks/workers-stack.js';

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

const messaging = new MessagingStack(app, `OrgFlow-${environment.name}-Messaging`, {
  environment,
  env,
});

// DockerImageAsset must be created inside a Stack's construct tree (CDK
// rejects one scoped directly under the App), and ApiStack needs the
// finished image as a constructor prop, so it cannot be its own scope. A
// small dedicated stack, rather than reusing NetworkStack or DataStack as
// a scope of convenience, keeps "the API's image" from being filed under
// an unrelated stack's assembly manifest for no reason other than it
// happened to exist first.
const assets = new Stack(app, `OrgFlow-${environment.name}-Assets`, { env });

// Built from the repository root, matching how apps/api/Dockerfile itself
// documents it must be invoked: `docker build -f apps/api/Dockerfile .`
// from the root, not from apps/api. DockerImageAsset runs that build once
// per `cdk synth`/`cdk deploy`, which is the reason ApiStack takes the
// resulting image as an injected prop rather than building it internally;
// infra/test/stacks.test.ts passes a stub image instead, so `pnpm test`
// never pays this cost.
const apiImageAsset = new ecr_assets.DockerImageAsset(assets, 'ApiImage', {
  directory: fileURLToPath(new URL('../../', import.meta.url)),
  file: 'apps/api/Dockerfile',
});

const apiStack = new ApiStack(app, `OrgFlow-${environment.name}-Api`, {
  environment,
  env,
  vpc: network.vpc,
  databaseUrlSecret: data.databaseUrlSecret,
  domainEventsTopic: messaging.domainEventsTopic,
  apiImage: ecs.ContainerImage.fromDockerImageAsset(apiImageAsset),
});

const workersStack = new WorkersStack(app, `OrgFlow-${environment.name}-Workers`, {
  environment,
  env,
  vpc: network.vpc,
  notificationsQueue: messaging.queues.notifications,
  databaseUrlSecret: data.databaseUrlSecret,
});

// TECH-STACK.md §7: cdk-nag with AWS Solutions rules; PRD.md §20 requires
// cdk synth to succeed with zero unsuppressed findings.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
applyNagSuppressions({ network, data, messaging, api: apiStack, workers: workersStack });
