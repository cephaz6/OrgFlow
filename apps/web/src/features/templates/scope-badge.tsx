import { StatusBadge } from '@orgflow/ui';
import { Building2, Globe, Sparkles } from 'lucide-react';

import type { TemplateScope } from './types';

// PRD.md §9.1's three scopes are the whole answer to "whose template is
// this, and what may I do with it", so the catalogue states it on every
// card rather than only on the detail view. StatusBadge takes an icon and a
// label as required arguments, so this cannot become a colour-only cue
// (CLAUDE.md §5.3).
export function ScopeBadge({ scope }: { scope: TemplateScope }) {
  switch (scope) {
    case 'system':
      return <StatusBadge tone="info" icon={Sparkles} label="Built in" />;
    case 'published':
      return <StatusBadge tone="success" icon={Globe} label="Shared library" />;
    default:
      return <StatusBadge tone="neutral" icon={Building2} label="Your organisation" />;
  }
}
