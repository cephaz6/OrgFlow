'use client';

import { Alert, Button } from '@orgflow/ui';
import { Download } from 'lucide-react';
import { useState } from 'react';

import { downloadCasesExport } from './api-client';

export interface ExportButtonProps {
  definitionId?: string;
}

type Phase = { kind: 'idle' } | { kind: 'working' } | { kind: 'failed'; message: string };

export function ExportButton({ definitionId }: ExportButtonProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  function trigger() {
    setPhase({ kind: 'working' });
    void downloadCasesExport(definitionId ? { definitionId } : {})
      .then(() => setPhase({ kind: 'idle' }))
      .catch((err: unknown) =>
        setPhase({
          kind: 'failed',
          message: err instanceof Error ? err.message : 'The export could not be downloaded.',
        }),
      );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" variant="outline" disabled={phase.kind === 'working'} onClick={trigger}>
        <Download aria-hidden="true" className="h-4 w-4" />
        {phase.kind === 'working' ? 'Preparing export...' : 'Export CSV'}
      </Button>
      {phase.kind === 'failed' ? <Alert variant="destructive">{phase.message}</Alert> : null}
    </div>
  );
}
