import type { ProcessDefinitionDocument } from '@orgflow/types';

import { ApiError } from '../../lib/api-error';
import { apiGet } from '../../lib/api-server';

// The catalogue projection the API returns (apps/api/src/routes/
// process-definitions.ts), which is narrower than the ProcessDefinition row.
export interface CatalogueEntry {
  definitionId: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  status: string;
  currentVersionId: string | null;
}

export interface DefinitionDetail {
  definition: CatalogueEntry;
  version: {
    versionId: string;
    versionNumber: number;
    status: string;
    publishedAt: string | null;
  };
  document: ProcessDefinitionDocument;
}

interface CataloguePage {
  data: CatalogueEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchCatalogue(): Promise<CatalogueEntry[]> {
  const page = await apiGet<CataloguePage>('/process-definitions');
  return page.data;
}

// Returns null rather than throwing on 404, so a page can render notFound()
// instead of an error boundary. Every other status is still an error: a 500
// from the integrity check must not be mistaken for "no such process".
export async function fetchDefinitionByKey(key: string): Promise<DefinitionDetail | null> {
  try {
    return await apiGet<DefinitionDetail>(`/process-definitions/by-key/${encodeURIComponent(key)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}
