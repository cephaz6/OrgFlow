import { Card, CardContent, CardHeader, CardTitle } from '@orgflow/ui';
import type { Metadata } from 'next';

import {
  DelegationForm,
  DelegationList,
  fetchMyDelegations,
} from '../../../../features/delegations';
import { PageHeader } from '../../../../features/shell';

export const metadata: Metadata = {
  title: 'Delegations: OrgFlow',
};

export default async function DelegationsPage() {
  const delegations = await fetchMyDelegations();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Delegations"
        description="Hand your tasks to a colleague while you are away, or see who has delegated to you."
      />

      <Card>
        <CardHeader>
          <CardTitle>Delegate my tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <DelegationForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your delegations</CardTitle>
        </CardHeader>
        <CardContent>
          <DelegationList delegations={delegations} />
        </CardContent>
      </Card>
    </div>
  );
}
