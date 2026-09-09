#!/bin/sh
# LocalStack runs every executable in /etc/localstack/init/ready.d once the
# edge port is serving. The compose service sets PERSISTENCE=0, so the
# container starts empty every time and the API's topic and bucket, and the
# workers' queues, have to be recreated here. Without it a fresh `pnpm dev`
# leaves the notification consumer logging QueueDoesNotExist forever.
#
# The names below must match the ORGFLOW_* values in .env. They are the local
# equivalents of the resources infra/src/stacks/messaging-stack.ts creates in
# a deployed environment.
set -eu

REGION=eu-west-2
TOPIC=orgflow-domain-events
BUCKET=orgflow-local-attachments
QUEUES='orgflow-notifications orgflow-attachments-scan'

# CreateTopic, CreateQueue and Subscribe all return the existing resource
# rather than failing, so replaying this script is harmless. CreateBucket is
# the exception: it raises BucketAlreadyOwnedByYou, which under `set -e` would
# abort the run before any queue was created, so it is guarded by head-bucket.
topic_arn=$(awslocal sns create-topic --region "$REGION" --name "$TOPIC" --output text --query TopicArn)

if ! awslocal s3api head-bucket --region "$REGION" --bucket "$BUCKET" >/dev/null 2>&1; then
  awslocal s3api create-bucket \
    --region "$REGION" \
    --bucket "$BUCKET" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
fi

for queue in $QUEUES; do
  queue_url=$(awslocal sqs create-queue --region "$REGION" --queue-name "$queue" --output text --query QueueUrl)
  queue_arn=$(awslocal sqs get-queue-attributes \
    --region "$REGION" \
    --queue-url "$queue_url" \
    --attribute-names QueueArn \
    --output text --query 'Attributes.QueueArn')

  # Raw message delivery, because workers/src/sqs/consumer.ts parses the body
  # as a DomainEvent rather than unwrapping an SNS envelope.
  awslocal sns subscribe \
    --region "$REGION" \
    --topic-arn "$topic_arn" \
    --protocol sqs \
    --notification-endpoint "$queue_arn" \
    --attributes RawMessageDelivery=true >/dev/null

  echo "orgflow: provisioned queue $queue subscribed to $TOPIC"
done

echo "orgflow: provisioned topic $TOPIC and bucket $BUCKET"
