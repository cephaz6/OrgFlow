import type { Transaction } from 'kysely';

import type { Database } from '../schema.js';
import { generateId } from '../uuid.js';

export interface NotificationPreference {
  templateKey: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

// Every override this user has ever set, for the settings screen: absence
// of a row for a given template reads as both channels on, the same
// default resolveNotificationChannels applies in the worker.
export async function findNotificationPreferencesForUser(
  trx: Transaction<Database>,
  userId: string,
): Promise<NotificationPreference[]> {
  const rows = await trx
    .selectFrom('notification_preferences')
    .select(['template_key', 'email_enabled', 'in_app_enabled'])
    .where('user_id', '=', userId)
    .execute();

  return rows.map((row) => ({
    templateKey: row.template_key,
    emailEnabled: row.email_enabled,
    inAppEnabled: row.in_app_enabled,
  }));
}

// The one row a notification handler needs, if this user has ever
// overridden this specific template. Null means "never touched", which
// the caller (workers/src/notifications/preferences.ts) treats as both
// channels enabled, not as both disabled.
export async function findNotificationPreference(
  trx: Transaction<Database>,
  userId: string,
  templateKey: string,
): Promise<NotificationPreference | null> {
  const row = await trx
    .selectFrom('notification_preferences')
    .select(['template_key', 'email_enabled', 'in_app_enabled'])
    .where('user_id', '=', userId)
    .where('template_key', '=', templateKey)
    .executeTakeFirst();

  return row
    ? {
        templateKey: row.template_key,
        emailEnabled: row.email_enabled,
        inAppEnabled: row.in_app_enabled,
      }
    : null;
}

export interface SetNotificationPreferenceInput {
  organisationId: string;
  userId: string;
  templateKey: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

// Upsert, not a plain insert: PATCHing a preference this user has already
// set once (turning a channel back on, say) is the ordinary case, not a
// conflict to refuse.
export async function setNotificationPreference(
  trx: Transaction<Database>,
  input: SetNotificationPreferenceInput,
): Promise<NotificationPreference> {
  const row = await trx
    .insertInto('notification_preferences')
    .values({
      preference_id: generateId(),
      organisation_id: input.organisationId,
      user_id: input.userId,
      template_key: input.templateKey,
      email_enabled: input.emailEnabled,
      in_app_enabled: input.inAppEnabled,
    })
    .onConflict((oc) =>
      oc.columns(['organisation_id', 'user_id', 'template_key']).doUpdateSet({
        email_enabled: input.emailEnabled,
        in_app_enabled: input.inAppEnabled,
        updated_at: new Date(),
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    templateKey: row.template_key,
    emailEnabled: row.email_enabled,
    inAppEnabled: row.in_app_enabled,
  };
}
