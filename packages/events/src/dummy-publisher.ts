import type { DomainEvent } from '@orgflow/types';

import type { DomainEventPublisher } from './publisher.js';

// CLAUDE.md naming: stand-in implementations are "dummy", never "fake".
export interface DummyDomainEventPublisher extends DomainEventPublisher {
  readonly published: DomainEvent[];
  clear(): void;
}

// Records what it was asked to publish and does nothing else. Used by unit
// tests that need to assert which events a code path emits without
// standing up SNS, and as the local fallback when no topic is configured.
export function createDummyPublisher(): DummyDomainEventPublisher {
  const published: DomainEvent[] = [];

  return {
    published,
    publish(events: DomainEvent[]): Promise<void> {
      published.push(...events);
      return Promise.resolve();
    },
    clear(): void {
      published.length = 0;
    },
  };
}
