import { apiPatch } from '../../lib/api-client';
import type { RetentionEntry } from './types';

export async function updateRetention(
  definitionId: string,
  retentionDays: number | null,
): Promise<RetentionEntry> {
  return apiPatch<RetentionEntry>(`/data-protection/retention/${definitionId}`, {
    retentionDays,
  });
}
