import { Card, CardContent, EmptyState } from '@orgflow/ui';
import { ShieldOff } from 'lucide-react';
import type { Metadata } from 'next';

import { fetchRetentionSettings, RetentionList } from '../../../../../features/data-protection';
import { HOME_CRUMB, PageHeader } from '../../../../../features/shell';

export const metadata: Metadata = {
  title: 'Retention: OrgFlow',
};

export default async function RetentionPage() {
  const definitions = await fetchRetentionSettings();

  if (definitions === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader breadcrumbs={[HOME_CRUMB]} title="Retention" />
        <EmptyState
          icon={ShieldOff}
          title="Admin access required"
          description="Managing retention needs the admin or owner role. Ask an administrator to grant it if you need to see this."
        />
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB]}
        title="Retention"
        description="How long a completed case is kept before it is redacted, per process. Leave blank to retain indefinitely."
      />

      <Card>
        <CardContent className="pt-6">
          <RetentionList definitions={definitions} />
        </CardContent>
      </Card>
    </div>
  );
}
