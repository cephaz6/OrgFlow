import { LocalstackContainer, type StartedLocalStackContainer } from '@testcontainers/localstack';

// Self-contained like every other integration suite in the repo: it starts
// its own LocalStack rather than relying on the docker-compose one. That
// matters because CI has Docker but does not run docker compose, so a
// suite that assumed the compose stack would pass locally and fail there.
let localstack: StartedLocalStackContainer | undefined;

export async function setup(): Promise<void> {
  localstack = await new LocalstackContainer('localstack/localstack:3').start();
  process.env.ORGFLOW_TEST_AWS_ENDPOINT = localstack.getConnectionUri();
}

export async function teardown(): Promise<void> {
  await localstack?.stop();
}
