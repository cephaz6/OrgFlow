import { findNotificationPreference, withTenantTransaction, type Database } from '@orgflow/db';
import type { Kysely } from 'kysely';

export interface NotificationChannels {
  email: boolean;
  inApp: boolean;
}

// Absence of a stored preference means both channels stay on: this is an
// opt-out model, not opt-in, so a recipient who has never visited the
// notification settings page keeps exactly today's behaviour, and this is
// the one place that default lives, shared by every handler below.
export async function resolveNotificationChannels(
  db: Kysely<Database>,
  organisationId: string,
  userId: string,
  templateKey: string,
): Promise<NotificationChannels> {
  const preference = await withTenantTransaction(db, organisationId, (trx) =>
    findNotificationPreference(trx, userId, templateKey),
  );

  return {
    email: preference?.emailEnabled ?? true,
    inApp: preference?.inAppEnabled ?? true,
  };
}
