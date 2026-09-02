import { apiGet } from '../../lib/api-server';
import type { TemplateCatalogue, TemplateScope } from './types';

export async function fetchTemplates(scope?: TemplateScope): Promise<TemplateCatalogue> {
  const path = scope ? `/templates?scope=${encodeURIComponent(scope)}` : '/templates';
  return apiGet<TemplateCatalogue>(path);
}
