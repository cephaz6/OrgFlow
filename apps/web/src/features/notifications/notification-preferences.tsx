'use client';

import { Alert } from '@orgflow/ui';
import { useState } from 'react';

import { updateNotificationPreference } from './api-client';
import { NOTIFICATION_TEMPLATE_INFO, type NotificationPreferenceEntry } from './types';

export interface NotificationPreferencesProps {
  preferences: NotificationPreferenceEntry[];
}

type Overrides = Record<string, Pick<NotificationPreferenceEntry, 'emailEnabled' | 'inAppEnabled'>>;

// Each row saves itself the moment a checkbox changes: a boolean toggle
// with an explicit "Save" button elsewhere in the way would add a step
// that gives nothing back, the same reasoning identity-providers.tsx's own
// instant Enable/Disable action already follows for a two-state control.
export function NotificationPreferences({ preferences }: NotificationPreferencesProps) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byTemplate = new Map(preferences.map((entry) => [entry.templateKey, entry]));

  async function toggle(
    templateKey: string,
    current: Pick<NotificationPreferenceEntry, 'emailEnabled' | 'inAppEnabled'>,
    patch: Partial<Pick<NotificationPreferenceEntry, 'emailEnabled' | 'inAppEnabled'>>,
  ) {
    const next = {
      emailEnabled: patch.emailEnabled ?? current.emailEnabled,
      inAppEnabled: patch.inAppEnabled ?? current.inAppEnabled,
    };
    // Applied immediately, before the request resolves: this is what
    // keeps a checked box checked through the click. A checkbox driven
    // straight from server-fetched props would snap back to its old value
    // the instant `busy` triggers a re-render, since the props themselves
    // have not caught up with the click yet, undoing the browser's own
    // native toggle before the request even reaches the network.
    setOverrides((current) => ({ ...current, [templateKey]: next }));
    setBusy(templateKey);
    setError(null);
    try {
      await updateNotificationPreference(templateKey, next);
    } catch (err) {
      // Reverts the optimistic update: the server never actually accepted
      // this change, so the box should not keep claiming it did.
      setOverrides((current) => {
        const { [templateKey]: _removed, ...rest } = current;
        return rest;
      });
      setError(err instanceof Error ? err.message : 'That preference could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-xl border-collapse text-sm">
          <caption className="sr-only">
            Which notifications you receive, and on which channels
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">
                Notification
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Email
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                In-app
              </th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TEMPLATE_INFO.map((info) => {
              // A template GET /notifications/preferences did not return
              // an override for reads as both channels on, matching the
              // server's own default (workers/src/notifications/
              // preferences.ts), not as both off. A local, still-pending
              // toggle wins over both, so the checkbox reflects what was
              // just clicked rather than momentarily reverting to it.
              const server = byTemplate.get(info.templateKey) ?? {
                templateKey: info.templateKey,
                emailEnabled: true,
                inAppEnabled: true,
              };
              const current = overrides[info.templateKey] ?? server;
              const rowBusy = busy === info.templateKey;

              return (
                <tr key={info.templateKey} className="border-b border-divider last:border-b-0">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="flex flex-col">
                      <span className="font-medium">{info.label}</span>
                      <span className="text-xs text-muted-foreground">{info.description}</span>
                    </span>
                  </th>
                  <td className="px-4 py-3">
                    <label className="sr-only" htmlFor={`email-${info.templateKey}`}>
                      Email for {info.label}
                    </label>
                    <input
                      id={`email-${info.templateKey}`}
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={current.emailEnabled}
                      disabled={rowBusy}
                      onChange={(event) =>
                        void toggle(info.templateKey, current, {
                          emailEnabled: event.target.checked,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <label className="sr-only" htmlFor={`in-app-${info.templateKey}`}>
                      In-app for {info.label}
                    </label>
                    <input
                      id={`in-app-${info.templateKey}`}
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={current.inAppEnabled}
                      disabled={rowBusy}
                      onChange={(event) =>
                        void toggle(info.templateKey, current, {
                          inAppEnabled: event.target.checked,
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
