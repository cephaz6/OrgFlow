import { EmptyState } from '@orgflow/ui';
import { LibraryBig } from 'lucide-react';
import type { Metadata } from 'next';

import { CatalogueGrid, fetchCatalogue } from '../../../features/catalogue';
import { PageHeader } from '../../../features/shell';

export const metadata: Metadata = {
  title: 'Catalogue — OrgFlow',
};

export default async function CataloguePage() {
  const entries = await fetchCatalogue();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catalogue"
        description="The processes your organisation has published. Choose one to start a request."
      />

      {entries.length === 0 ? (
        <EmptyState
          icon={LibraryBig}
          title="No processes published yet"
          description="A process owner needs to build and publish a process before anyone can start a request. Nothing is available to you until then."
        />
      ) : (
        <CatalogueGrid entries={entries} />
      )}
    </div>
  );
}
