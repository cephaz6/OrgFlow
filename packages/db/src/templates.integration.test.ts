import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './connection.js';
import { createOrganisation } from './repositories/organisations.js';
import {
  createTemplate,
  deleteTemplate,
  findSystemTemplateById,
  findTemplateById,
  listBrowsableTemplates,
  setTemplateScope,
  updateTemplate,
} from './repositories/templates.js';
import { createUserWithIdentity } from './repositories/users.js';
import type { Database } from './schema.js';
import { withTenantTransaction } from './tenant-transaction.js';
import { generateId } from './uuid.js';

// PRD.md §9 and ADR-0042. The point of these tests is the asymmetry the
// migration encodes: an organisation template is invisible across tenants
// like every other row, a published one is deliberately readable but still
// not writable, and the system catalogue belongs to nobody.
async function seedTenant(db: Kysely<Database>, label: string) {
  const user = await createUserWithIdentity(db, {
    email: `${label}-${generateId()}@example.invalid`,
    displayName: `${label} user`,
    issuer: 'urn:orgflow:test',
    subject: `${label}-${generateId()}`,
  });

  const organisation = await createOrganisation(db, {
    name: `${label} tenant`,
    slug: `${label}-${generateId()}`,
    createdByUserId: user.userId,
  });

  return { userId: user.userId, organisationId: organisation.organisationId };
}

describe('templates', () => {
  let db: Kysely<Database>;
  let alpha: { userId: string; organisationId: string };
  let beta: { userId: string; organisationId: string };
  let systemTemplateId: string;

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    alpha = await seedTenant(db, 'alpha');
    beta = await seedTenant(db, 'beta');

    // Seeded on the unscoped connection, standing in for the migration-time
    // seeding the six system templates will get: orgflow_app holds SELECT
    // on this table and nothing more.
    systemTemplateId = generateId();
    await db
      .insertInto('system_templates')
      .values({
        template_id: systemTemplateId,
        key: `annual-leave-${generateId()}`,
        name: 'Annual leave request',
        description: 'Single-step manager approval',
        category: 'People',
        icon: null,
        document_id: `doc-${generateId()}`,
      })
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom('system_templates').where('template_id', '=', systemTemplateId).execute();
    await db.destroy();
  });

  it('keeps an organisation-scoped template invisible to another tenant', async () => {
    const templateId = await withTenantTransaction(db, alpha.organisationId, (trx) =>
      createTemplate(trx, {
        templateId: generateId(),
        organisationId: alpha.organisationId,
        key: `private-${generateId()}`,
        name: 'Alpha private template',
        description: null,
        category: null,
        icon: null,
        documentId: `doc-${generateId()}`,
        createdByUserId: alpha.userId,
      }),
    );

    const asOwner = await withTenantTransaction(db, alpha.organisationId, (trx) =>
      findTemplateById(trx, templateId),
    );
    expect(asOwner?.name).toBe('Alpha private template');

    const asOtherTenant = await withTenantTransaction(db, beta.organisationId, (trx) =>
      findTemplateById(trx, templateId),
    );
    // Absence, not a permission error: CLAUDE.md §3 requires cross-tenant
    // access to be indistinguishable from the row not existing.
    expect(asOtherTenant).toBeNull();
  });

  it('makes a published template readable across tenants, but still not writable', async () => {
    const templateId = await withTenantTransaction(db, alpha.organisationId, async (trx) => {
      const id = await createTemplate(trx, {
        templateId: generateId(),
        organisationId: alpha.organisationId,
        key: `shared-${generateId()}`,
        name: 'Alpha shared template',
        description: null,
        category: null,
        icon: null,
        documentId: `doc-${generateId()}`,
        createdByUserId: alpha.userId,
      });
      await setTemplateScope(trx, id, 'published');
      return id;
    });

    const asOtherTenant = await withTenantTransaction(db, beta.organisationId, (trx) =>
      findTemplateById(trx, templateId),
    );
    expect(asOtherTenant?.name).toBe('Alpha shared template');
    expect(asOtherTenant?.scope).toBe('published');

    // The published policy is FOR SELECT, so the write matches no row
    // rather than succeeding: sharing a template does not surrender it.
    const updated = await withTenantTransaction(db, beta.organisationId, (trx) =>
      updateTemplate(trx, templateId, { name: 'Hijacked by beta' }),
    );
    expect(updated).toBe(false);

    const stillOwned = await withTenantTransaction(db, alpha.organisationId, (trx) =>
      findTemplateById(trx, templateId),
    );
    expect(stillOwned?.name).toBe('Alpha shared template');

    // Nor can another tenant delete it.
    const deleted = await withTenantTransaction(db, beta.organisationId, (trx) =>
      deleteTemplate(trx, templateId),
    );
    expect(deleted).toBe(false);
  });

  it('shows the system catalogue to every tenant', async () => {
    for (const tenant of [alpha, beta]) {
      const found = await withTenantTransaction(db, tenant.organisationId, (trx) =>
        findSystemTemplateById(trx, systemTemplateId),
      );
      expect(found?.name).toBe('Annual leave request');
      expect(found?.organisationId).toBeNull();
      expect(found?.scope).toBe('system');
    }
  });

  it('browses the system catalogue, own templates and the shared library together', async () => {
    const ownKey = `own-${generateId()}`;
    await withTenantTransaction(db, beta.organisationId, (trx) =>
      createTemplate(trx, {
        templateId: generateId(),
        organisationId: beta.organisationId,
        key: ownKey,
        name: 'Beta own template',
        description: null,
        category: null,
        icon: null,
        documentId: `doc-${generateId()}`,
        createdByUserId: beta.userId,
      }),
    );

    const browsable = await withTenantTransaction(db, beta.organisationId, (trx) =>
      listBrowsableTemplates(trx),
    );

    const scopesByName = new Map(browsable.map((row) => [row.name, row.scope]));
    expect(scopesByName.get('Annual leave request')).toBe('system');
    expect(scopesByName.get('Beta own template')).toBe('organisation');
    expect(scopesByName.get('Alpha shared template')).toBe('published');
    // Alpha's unshared template is not in anyone else's catalogue.
    expect(scopesByName.has('Alpha private template')).toBe(false);
  });
});
