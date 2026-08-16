import { StatusBadge, type StatusTone } from '@orgflow/ui';
import { Archive, CheckCircle2, FileEdit } from 'lucide-react';

const PRESENTATION: Record<string, { tone: StatusTone; icon: typeof FileEdit; label: string }> = {
  draft: { tone: 'neutral', icon: FileEdit, label: 'Draft' },
  published: { tone: 'success', icon: CheckCircle2, label: 'Published' },
  archived: { tone: 'neutral', icon: Archive, label: 'Archived' },
};

export function DefinitionStatusBadge({ status }: { status: string }) {
  const presentation = PRESENTATION[status] ?? PRESENTATION.draft!;
  return (
    <StatusBadge tone={presentation.tone} icon={presentation.icon} label={presentation.label} />
  );
}
