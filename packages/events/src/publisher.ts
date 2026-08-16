import type { DomainEvent } from '@orgflow/types';

// The seam every event producer talks to. ADR-0008 and the 3pservice
// pattern: the transport sits behind an interface with a dummy
// implementation, so swapping SNS for something else, or for nothing at
// all in a test, is a construction-time choice rather than a code change.
//
// Call this *after* the transaction that recorded the state change has
// committed (TECH-STACK.md §6). Publishing inside the transaction would
// announce something that might still roll back; publishing before it
// would announce something that had not happened yet.
//
// The consequence, stated plainly because it is a real trade: a crash
// between commit and publish loses the event. PRD.md §10's consumers are
// idempotent and keyed on eventId, so redelivery is safe, but a lost event
// is not recovered by that. Closing the gap needs a transactional outbox,
// which is listed in TECH-STACK.md §13 and not built yet.
export interface DomainEventPublisher {
  publish(events: DomainEvent[]): Promise<void>;
}
