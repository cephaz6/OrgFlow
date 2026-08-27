import type { DomainEvent } from '@orgflow/types';

import { handleAttachmentUploaded, type AttachmentScanDeps } from './handle-attachment-uploaded.js';

// PRD.md §10 consumer contract: unknown event types are ignored, not
// errored, for forward compatibility. Mirrors notifications/dispatch.ts's
// own table exactly, one entry, since this queue's own subscription
// (PR4's CDK work) only ever needs to carry attachment.uploaded, but the
// topic still fans out every event type to it.
const HANDLED: Record<string, (deps: AttachmentScanDeps, event: DomainEvent) => Promise<unknown>> =
  {
    'attachment.uploaded': handleAttachmentUploaded,
  };

export async function dispatchAttachmentScanEvent(
  deps: AttachmentScanDeps,
  event: DomainEvent,
): Promise<{ handled: boolean }> {
  const handler = HANDLED[event.eventType];

  if (!handler) {
    deps.logger.debug(
      { eventId: event.eventId, eventType: event.eventType },
      'no attachment-scan handler for this event type; ignoring',
    );
    return { handled: false };
  }

  await handler(deps, event);
  return { handled: true };
}
