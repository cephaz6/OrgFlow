export { createMongoClient } from './connection.js';
export type { MongoConnectionConfig } from './connection.js';
export { pingMongo } from './health.js';
export {
  caseValuesCollection,
  COLLECTIONS,
  ensureIndexes,
  processDefinitionsCollection,
} from './collections.js';
export { hashDocument } from './document-hash.js';
export {
  findLatestProcessDefinitionDocument,
  findProcessDefinitionDocumentById,
  insertProcessDefinitionDocument,
  updateProcessDefinitionDocument,
  verifyDocumentIntegrity,
} from './process-definitions.js';
export type { ReadProcessDefinitionDocument, StoredDefinition } from './process-definitions.js';
export { findCaseValues, readCaseValues, upsertCaseValues } from './case-values.js';
export type { UpsertCaseValuesInput } from './case-values.js';
export type { CaseValuesDocument, StoredProcessDefinitionDocument } from './types.js';
export {
  buildLaptopRequestDefinition,
  IT_SUPPORT_GROUP_KEY,
  LAPTOP_REQUEST_KEY,
  LAPTOP_REQUEST_REFERENCE_PREFIX,
} from './seed/laptop-request.js';
export type { BuildLaptopRequestInput } from './seed/laptop-request.js';
