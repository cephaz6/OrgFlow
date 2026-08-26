import { Button, EmptyState } from '@orgflow/ui';
import { ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CaseList, fetchMyCases } from '../../../features/cases';
import { fetchCatalogue } from '../../../features/catalogue';
import { PageHeader } from '../../../features/shell';

export const metadata: Metadata = {
  title: 'My requests: OrgFlow',
};

export default async function MyCasesPage() {
  // The catalogue supplies process names, which the case list projection
  // does not carry. Fetched in parallel rather than in sequence: neither
  // depends on the other, and the page cannot render until both arrive. A
  // large, unpaginated limit: this is an id-to-name lookup, not a browsable
  // list, so it wants effectively everything rather than a first page an
  // organisation with more processes than that would silently truncate.
  const [cases, cataloguePage] = await Promise.all([
    fetchMyCases(),
    fetchCatalogue({ limit: 200 }),
  ]);

  const processNames = Object.fromEntries(
    cataloguePage.data.map((entry) => [entry.definitionId, entry.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My requests"
        description="Everything you have submitted, and what is happening to it."
        actions={
          <Button asChild>
            <Link href="/catalogue">Start a request</Link>
          </Button>
        }
      />

      {cases.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="You have not submitted anything yet"
          description="Requests you submit will appear here, with their reference and current status."
          action={
            <Button asChild variant="outline">
              <Link href="/catalogue">Browse the catalogue</Link>
            </Button>
          }
        />
      ) : (
        <CaseList cases={cases} processNames={processNames} />
      )}
    </div>
  );
}
