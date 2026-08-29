'use client';

import { Alert, Button, EmptyState, Input, Label, StatusBadge } from '@orgflow/ui';
import { KeyRound, Pencil, ShieldOff, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { deleteIdentityProvider, updateIdentityProvider } from './api-client';
import type { IdentityProviderEntry } from './types';

export interface IdentityProviderListProps {
  providers: IdentityProviderEntry[];
}

function parseDomains(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function IdentityProviderList({ providers }: IdentityProviderListProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="No identity providers configured"
        description="Add one using the form above. Until then, only the platform Google sign-in works."
      />
    );
  }

  async function run(providerId: string, action: () => Promise<unknown>) {
    setBusy(providerId);
    setError(null);
    try {
      await action();
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-3xl border-collapse text-sm">
          <caption className="sr-only">Identity providers configured for this organisation</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">
                Provider
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Email domains
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.providerId} className="border-b border-divider last:border-b-0">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <span className="flex flex-col">
                    <span className="font-medium">{provider.displayName}</span>
                    <span className="text-xs text-muted-foreground">{provider.issuerUrl}</span>
                  </span>
                </th>
                <td className="px-4 py-3">{provider.emailDomains.join(', ')}</td>
                <td className="px-4 py-3">
                  <StatusBadge
                    tone={provider.enabled ? 'success' : 'neutral'}
                    icon={KeyRound}
                    label={provider.enabled ? 'Enabled' : 'Disabled'}
                  />
                </td>
                <td className="px-4 py-3">
                  <span className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy === provider.providerId}
                      onClick={() =>
                        void run(provider.providerId, () =>
                          updateIdentityProvider(provider.providerId, {
                            enabled: !provider.enabled,
                          }),
                        )
                      }
                    >
                      {provider.enabled ? 'Disable' : 'Enable'}
                      <span className="sr-only"> {provider.displayName}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={editing === provider.providerId}
                      onClick={() =>
                        setEditing(editing === provider.providerId ? null : provider.providerId)
                      }
                    >
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                      Edit
                      <span className="sr-only"> {provider.displayName}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy === provider.providerId}
                      onClick={() =>
                        void run(provider.providerId, () =>
                          deleteIdentityProvider(provider.providerId),
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                      Remove
                      <span className="sr-only"> {provider.displayName}</span>
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <ProviderEditor
          provider={providers.find((entry) => entry.providerId === editing)!}
          busy={busy === editing}
          onCancel={() => setEditing(null)}
          onSave={(input) => void run(editing, () => updateIdentityProvider(editing, input))}
        />
      ) : null}
    </div>
  );
}

interface ProviderEditorProps {
  provider: IdentityProviderEntry;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    displayName: string;
    issuerUrl: string;
    clientId: string;
    clientSecretRef: string;
    emailDomains: string[];
  }) => void;
}

// clientSecretRef is prefilled with the existing ARN rather than blanked:
// this is a reference the admin is meant to be able to see and correct, not
// a secret that must never round-trip back to the screen it came from.
function ProviderEditor({ provider, busy, onCancel, onSave }: ProviderEditorProps) {
  const [displayName, setDisplayName] = useState(provider.displayName);
  const [issuerUrl, setIssuerUrl] = useState(provider.issuerUrl);
  const [clientId, setClientId] = useState(provider.clientId);
  const [clientSecretRef, setClientSecretRef] = useState(provider.clientSecretRef);
  const [emailDomains, setEmailDomains] = useState(provider.emailDomains.join(', '));

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          displayName,
          issuerUrl,
          clientId,
          clientSecretRef,
          emailDomains: parseDomains(emailDomains),
        });
      }}
    >
      <p className="text-sm font-medium">Editing {provider.displayName}</p>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`edit-name-${provider.providerId}`}>Display name</Label>
        <Input
          id={`edit-name-${provider.providerId}`}
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`edit-issuer-${provider.providerId}`}>Issuer URL</Label>
        <Input
          id={`edit-issuer-${provider.providerId}`}
          type="url"
          required
          value={issuerUrl}
          onChange={(event) => setIssuerUrl(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`edit-client-id-${provider.providerId}`}>Client ID</Label>
        <Input
          id={`edit-client-id-${provider.providerId}`}
          required
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`edit-secret-ref-${provider.providerId}`}>Client secret ARN</Label>
        <Input
          id={`edit-secret-ref-${provider.providerId}`}
          required
          value={clientSecretRef}
          onChange={(event) => setClientSecretRef(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`edit-domains-${provider.providerId}`}>Email domains</Label>
        <Input
          id={`edit-domains-${provider.providerId}`}
          required
          value={emailDomains}
          onChange={(event) => setEmailDomains(event.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save changes'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
