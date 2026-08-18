import { config } from '../../config/env';
import { toApiError } from '../../lib/api-error';
import { parseFilename } from './parse-filename';

export interface ExportFilters {
  definitionId?: string;
  status?: string;
}

// apiPost assumes a JSON response body; this response is a CSV attachment,
// so it needs its own fetch that reads a Blob and triggers a real browser
// download rather than returning parsed JSON.
export async function downloadCasesExport(filters: ExportFilters = {}): Promise<void> {
  const response = await fetch(`${config.NEXT_PUBLIC_ORGFLOW_API_URL}/exports`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(filters),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  const blob = await response.blob();
  const filename =
    parseFilename(response.headers.get('content-disposition')) ?? 'orgflow-export.csv';

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
