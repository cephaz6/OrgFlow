import { generateId, type Database } from '@orgflow/db';
import {
  insertSystemTemplateDocument,
  SYSTEM_TEMPLATES,
  templatesCollection,
} from '@orgflow/documents';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';

// PRD.md §9.3's catalogue, written once at boot rather than per
// organisation, because a system template belongs to no tenant (ADR-0042).
//
// Not a SQL migration, even though system_templates is otherwise
// migration-owned data: half of each template is a Mongo document, and a
// migration cannot write Mongo. So it runs here, on the unscoped
// connection, which holds the owner role. orgflow_app has SELECT on that
// table and nothing more, so nothing reachable from a request could write
// this even by accident.
//
// Idempotent, and safe on every boot: an existing key is left alone rather
// than rewritten, so a template somebody has already cloned keeps behaving
// the way it did when they cloned it. Changing a shipped template means
// changing its key, which is the same discipline version pinning applies to
// definitions.
export async function ensureSystemTemplatesSeeded(
  db: Kysely<Database>,
  mongoClient: MongoClient,
): Promise<number> {
  const existing = await db.selectFrom('system_templates').select('key').execute();
  const seeded = new Set(existing.map((row) => row.key));

  let inserted = 0;
  for (const template of SYSTEM_TEMPLATES) {
    if (seeded.has(template.key)) {
      continue;
    }

    const templateId = generateId();
    const now = new Date().toISOString();

    // Document first, then the row pointing at it, the same ordering the
    // templates route uses: a registry row that references a missing
    // blueprint is the failure worth avoiding, and an orphaned document is
    // inert.
    const documentId = await insertSystemTemplateDocument(mongoClient, {
      templateId,
      blueprint: template.blueprint,
      now,
    });

    try {
      await db
        .insertInto('system_templates')
        .values({
          template_id: templateId,
          key: template.key,
          name: template.name,
          description: template.description,
          category: template.category,
          icon: template.icon,
          document_id: documentId,
        })
        .execute();
      inserted += 1;
    } catch (err) {
      // Two API instances booting together both see the key as absent and
      // both insert. The unique constraint on key is what makes that safe;
      // losing the race is not an error, it means somebody else did the
      // work. The document just written is left behind, unreferenced.
      await templatesCollection(mongoClient).deleteOne({ templateId });
      if (!isUniqueViolation(err)) {
        throw err;
      }
    }
  }

  return inserted;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}
