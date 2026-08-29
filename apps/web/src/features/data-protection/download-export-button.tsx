'use client';

import { Button } from '@orgflow/ui';
import { Download } from 'lucide-react';

import type { SubjectExport } from './types';

export interface DownloadExportButtonProps {
  data: SubjectExport;
}

// A client component for exactly one reason: building the Blob and
// triggering the browser's own save dialog needs `window`, which a Server
// Component cannot reach. The export itself was already fetched server-
// side (fetchSubjectExport); this only re-serialises what is already on
// the page, it makes no second request.
export function DownloadExportButton({ data }: DownloadExportButtonProps) {
  function download() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `subject-export-${data.user.userId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button type="button" variant="outline" onClick={download}>
      <Download aria-hidden="true" className="h-4 w-4" />
      Download JSON
    </Button>
  );
}
