import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';

import {
  fetchIdentityProviders,
  IdentityProviderForm,
  IdentityProviderList,
} from '../../../../features/identity-providers';
import { HOME_CRUMB, PageHeader } from '../../../../features/shell';

export const metadata: Metadata = {
  title: 'Identity providers: OrgFlow',
};

export default async function IdentityProvidersPage() {
  const providers = await fetchIdentityProviders();

  if (providers === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader breadcrumbs={[HOME_CRUMB]} title="Identity providers" />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Configuring identity providers needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB]}
        title="Identity providers"
        description="OIDC providers this organisation's members sign in through, routed by their email domain."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add an identity provider</CardTitle>
        </CardHeader>
        <CardContent>
          <IdentityProviderForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configured providers</CardTitle>
        </CardHeader>
        <CardContent>
          <IdentityProviderList providers={providers} />
        </CardContent>
      </Card>
    </div>
  );
}
