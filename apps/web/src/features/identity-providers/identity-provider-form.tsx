'use client';

import { Alert, Button, Input, Label } from '@orgflow/ui';
import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createIdentityProvider } from './api-client';

function parseDomains(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

// Client secrets are never entered here: clientSecretRef is the Secrets
// Manager ARN of a secret provisioned out of band, the same placeholder-ref
// pattern DataStack's databaseUrlSecret already uses (documentation/
// decisions.md ADR-0007). Live resolution of that ARN into a usable secret
// at login time is a documented, separate follow-up; this form only records
// where the secret lives, never its value.
export function IdentityProviderForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecretRef, setClientSecretRef] = useState('');
  const [emailDomains, setEmailDomains] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createIdentityProvider({
        displayName,
        issuerUrl,
        clientId,
        clientSecretRef,
        emailDomains: parseDomains(emailDomains),
      });
      setDisplayName('');
      setIssuerUrl('');
      setClientId('');
      setClientSecretRef('');
      setEmailDomains('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That provider could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="idp-display-name">Display name</Label>
        <Input
          id="idp-display-name"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Contoso Entra ID"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="idp-issuer-url">Issuer URL</Label>
        <Input
          id="idp-issuer-url"
          type="url"
          required
          value={issuerUrl}
          onChange={(event) => setIssuerUrl(event.target.value)}
          placeholder="https://login.microsoftonline.com/{tenant}/v2.0"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="idp-client-id">Client ID</Label>
        <Input
          id="idp-client-id"
          required
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="idp-client-secret-ref">Client secret ARN</Label>
        <Input
          id="idp-client-secret-ref"
          required
          value={clientSecretRef}
          onChange={(event) => setClientSecretRef(event.target.value)}
          placeholder="arn:aws:secretsmanager:eu-west-2:123456789012:secret:contoso-oidc-client-secret"
          aria-describedby="idp-client-secret-ref-description"
        />
        <p id="idp-client-secret-ref-description" className="text-xs text-muted-foreground">
          The ARN of a secret already stored in AWS Secrets Manager, not the secret itself. Create
          the secret there first, then paste its ARN here.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="idp-email-domains">Email domains</Label>
        <Input
          id="idp-email-domains"
          required
          value={emailDomains}
          onChange={(event) => setEmailDomains(event.target.value)}
          placeholder="contoso.com, contoso.co.uk"
          aria-describedby="idp-email-domains-description"
        />
        <p id="idp-email-domains-description" className="text-xs text-muted-foreground">
          Comma-separated. A sign-in email matching one of these domains routes to this provider.
        </p>
      </div>

      <Button type="submit" disabled={busy} className="self-start">
        <KeyRound aria-hidden="true" className="h-4 w-4" />
        {busy ? 'Saving...' : 'Add identity provider'}
      </Button>
    </form>
  );
}
