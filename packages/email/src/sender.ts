// ADR-0008 and the 3pservice pattern: the delivery channel sits behind an
// interface with a dummy implementation, so swapping SES for another
// provider, or for nothing at all in a test, is a construction-time choice
// rather than a code change.
export interface EmailMessage {
  to: string;
  subject: string;
  // Both are always supplied. GOV-STANDARDS.md §8 wants plain English and an
  // explicit next action, and a recipient whose client blocks HTML must get
  // the same message, not an empty one.
  textBody: string;
  htmlBody: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
