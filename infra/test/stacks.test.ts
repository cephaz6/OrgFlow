import { App, aws_ecs as ecs, Aspects, type Stack } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';

import { applyNagSuppressions } from '../src/nag-suppressions.js';
import { ApiStack } from '../src/stacks/api-stack.js';
import { DataStack } from '../src/stacks/data-stack.js';
import { MessagingStack } from '../src/stacks/messaging-stack.js';
import { NetworkStack } from '../src/stacks/network-stack.js';
import { WorkersStack } from '../src/stacks/workers-stack.js';

// Mirrors bin/app.ts: same stacks, same cdk-nag wiring, so this test
// exercises the exact synth path a real `cdk synth` runs, environment-
// agnostic (no AWS credentials needed) since account is left undefined.
function buildStacks() {
  const app = new App({ context: { env: 'dev' } });
  const environment = {
    name: 'dev' as const,
    isProduction: false,
    account: undefined,
    region: 'eu-west-2',
    webUrl: 'https://app.orgflow-dev.example',
    sesDomain: 'orgflow-dev.example',
  };
  const env = { account: environment.account, region: environment.region };

  const network = new NetworkStack(app, 'TestNetwork', { environment, env });
  const data = new DataStack(app, 'TestData', { environment, env, vpc: network.vpc });
  const messaging = new MessagingStack(app, 'TestMessaging', { environment, env });

  // A tiny public-registry image rather than a real DockerImageAsset: this
  // suite must stay fast and offline, and neither the synthesised template
  // shape nor cdk-nag cares whether the image reference could actually
  // serve traffic, only that it is a valid one.
  const api = new ApiStack(app, 'TestApi', {
    environment,
    env,
    vpc: network.vpc,
    databaseUrlSecret: data.databaseUrlSecret,
    domainEventsTopic: messaging.domainEventsTopic,
    apiImage: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/busybox:stable'),
  });

  const workers = new WorkersStack(app, 'TestWorkers', {
    environment,
    env,
    vpc: network.vpc,
    notificationsQueue: messaging.queues.notifications,
    databaseUrlSecret: data.databaseUrlSecret,
  });

  Aspects.of(app).add(new AwsSolutionsChecks());
  applyNagSuppressions({ network, data, messaging, api, workers });

  return { network, data, messaging, api, workers };
}

function expectNoUnsuppressedFindings(stack: Stack) {
  const errors = Annotations.fromStack(stack).findError(
    '*',
    Match.stringLikeRegexp('AwsSolutions-.*'),
  );
  const warnings = Annotations.fromStack(stack).findWarning(
    '*',
    Match.stringLikeRegexp('AwsSolutions-.*'),
  );
  expect([...errors, ...warnings].map((finding) => finding.entry.data)).toEqual([]);
}

describe('CDK skeleton: cdk synth and cdk-nag', () => {
  it('synthesises NetworkStack with no unsuppressed cdk-nag findings', () => {
    const { network } = buildStacks();
    expectNoUnsuppressedFindings(network);
    expect(Template.fromStack(network).toJSON()).toMatchSnapshot();
  });

  it('synthesises DataStack with no unsuppressed cdk-nag findings', () => {
    const { data } = buildStacks();
    expectNoUnsuppressedFindings(data);
    expect(Template.fromStack(data).toJSON()).toMatchSnapshot();
  });

  it('synthesises MessagingStack with no unsuppressed cdk-nag findings', () => {
    const { messaging } = buildStacks();
    expectNoUnsuppressedFindings(messaging);
    expect(Template.fromStack(messaging).toJSON()).toMatchSnapshot();
  });

  it('synthesises ApiStack with no unsuppressed cdk-nag findings', () => {
    const { api } = buildStacks();
    expectNoUnsuppressedFindings(api);
    expect(Template.fromStack(api).toJSON()).toMatchSnapshot();
  });

  it('synthesises WorkersStack with no unsuppressed cdk-nag findings', () => {
    const { workers } = buildStacks();
    expectNoUnsuppressedFindings(workers);
    expect(Template.fromStack(workers).toJSON()).toMatchSnapshot();
  });
});
