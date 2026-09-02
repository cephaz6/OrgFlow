import type { IsoDateTimeString, Uuid } from './common.js';
import type { ProcessDefinitionDocument } from './definition-document.js';

// PRD.md §9.1. `system` is OrgFlow's own read-only catalogue and belongs to
// no organisation, so it lives in its own table rather than as a nullable
// tenant column (ADR-0042); the other two scopes are rows a tenant owns.
export type TemplateScope = 'system' | 'organisation' | 'published';

// The scopes a row in the tenant-owned `templates` table can carry. A
// template becomes `published` when its owner opts into the shared library,
// and it keeps its owning organisation either way.
export type OrganisationTemplateScope = Extract<TemplateScope, 'organisation' | 'published'>;

export interface Template {
  templateId: Uuid;
  organisationId: Uuid;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  scope: OrganisationTemplateScope;
  documentId: string;
  createdByUserId: Uuid;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

// PRD.md §9.3's six. Reference data owned by OrgFlow rather than by any
// tenant, so it carries no organisationId and no creating user.
export interface SystemTemplate {
  templateId: Uuid;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  documentId: string;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

// What both tables point at in Mongo. A template is a blueprint rather than
// something that runs, so it carries a definition document without the
// identifiers that tie a document to a particular organisation, definition
// or version: a clone supplies those for itself.
export type TemplateBlueprint = Omit<
  ProcessDefinitionDocument,
  'organisationId' | 'definitionId' | 'versionNumber' | 'createdByUserId' | 'createdAt'
>;

export interface TemplateDocument {
  organisationId: Uuid | null;
  templateId: Uuid;
  blueprint: TemplateBlueprint;
  createdAt: IsoDateTimeString;
}

// A template that could be browsed, from either table, flattened into the
// one shape the catalogue and its API render. `organisationId` is null for
// a system template, which is the only place the two genuinely differ.
export interface BrowsableTemplate {
  templateId: Uuid;
  organisationId: Uuid | null;
  scope: TemplateScope;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
}
