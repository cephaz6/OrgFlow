import type { EmailMessage, EmailSender } from './sender.js';

// CLAUDE.md naming: stand-in implementations are "dummy", never "fake".
export interface DummyEmailSender extends EmailSender {
  readonly sent: EmailMessage[];
  clear(): void;
}

// Records what it was asked to send and does nothing else. This is the
// local development implementation as well as the test one: the Phase 1
// plan makes the SNS and SQS path real but deliberately stops short of
// delivering real email, so nothing here reaches a mailbox by accident.
export function createDummyEmailSender(): DummyEmailSender {
  const sent: EmailMessage[] = [];

  return {
    sent,
    send(message: EmailMessage): Promise<void> {
      sent.push(message);
      return Promise.resolve();
    },
    clear(): void {
      sent.length = 0;
    },
  };
}
