// Mirrors what apps/api/src/routes/templates.ts returns. PRD.md §9.1's
// three scopes reach the client unchanged, because which one a template
// carries is exactly what the catalogue has to explain to a reader: whose
// template this is, and therefore what they may do with it.
export type TemplateScope = 'system' | 'organisation' | 'published';

export interface BrowsableTemplate {
  templateId: string;
  // Null for a system template, which belongs to no organisation
  // (ADR-0042).
  organisationId: string | null;
  scope: TemplateScope;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
}

export interface TemplateCatalogue {
  data: BrowsableTemplate[];
}

// ADR-0043: what a clone could not carry across, named rather than counted,
// so the message can say which step pointed at what.
export interface CloneWarning {
  stepKey: string;
  stepName: string;
  original: string;
  reason: 'specificUser' | 'group';
}

export interface CloneResult {
  definitionId: string;
  key: string;
  name: string;
  versionId: string;
  warnings: CloneWarning[];
}
