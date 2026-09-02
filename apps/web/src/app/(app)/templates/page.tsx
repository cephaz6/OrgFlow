import { EmptyState } from '@orgflow/ui';
import { LayoutTemplate } from 'lucide-react';
import type { Metadata } from 'next';

import { getSession } from '../../../features/auth';
import { HOME_CRUMB, PageHeader } from '../../../features/shell';
import { fetchTemplates, TemplateGrid } from '../../../features/templates';

export const metadata: Metadata = {
  title: 'Templates: OrgFlow',
};

// Cloning is gated to the same roles that may create a process, matching
// apps/api/src/routes/templates.ts. Browsing is not: PRD.md §9 makes the
// catalogue the thing somebody looks at before they own a process, so a
// plain member sees it without the buttons rather than a locked door.
const CLONE_ROLES = new Set(['processOwner', 'admin', 'owner']);

export default async function TemplatesPage() {
  const session = await getSession();
  const canClone = session?.roles.some((role) => CLONE_ROLES.has(role)) ?? false;

  const { data } = await fetchTemplates();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[HOME_CRUMB]}
        title="Templates"
        description="Start from a ready-made process rather than a blank one. Copying a template makes an independent draft, so later changes to the template never reach your copy."
      />

      {data.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No templates yet"
          description="Nothing has been shared with your organisation, and you have not saved a process as a template. Publish a process, then save it as a template to reuse it."
        />
      ) : (
        <TemplateGrid templates={data} canClone={canClone} />
      )}
    </div>
  );
}
