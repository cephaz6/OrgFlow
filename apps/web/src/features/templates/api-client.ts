import { apiPost } from '../../lib/api-client';
import type { CloneResult } from './types';

export async function cloneTemplate(templateId: string): Promise<CloneResult> {
  return apiPost<CloneResult>(`/templates/${templateId}/clone`, {});
}
