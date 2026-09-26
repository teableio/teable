// Schema (DDL) exports - re-export selectively to avoid conflicts
export type { IV2PostgresDdlAdapterConfig } from './schema';
export { v2PostgresDdlAdapterConfigSchema } from './schema';
export {
  FieldValueChangeCollectorVisitor,
  TableAddFieldCollectorVisitor,
  TableSchemaUpdateVisitor,
} from './schema';
export * from './schema/rules';
export * from './schema/repositories';
export * from './schema/naming';
export { FormulaAdmissionService } from './schema/admission/FormulaAdmissionService';
export { FormulaAdmissionFieldOperationPlugin } from './schema/admission/FormulaAdmissionFieldOperationPlugin';
export { FormulaSourceBudgetCommandBusMiddleware } from './schema/admission/FormulaSourceBudgetCommandBusMiddleware';

// Record (DML) exports - re-export selectively to avoid conflicts
export { PostgresTableRecordRepository, PostgresTableRecordQueryRepository } from './record';
export * from './record/computed';
export * from './record/query-builder';
export * from './record/visitors';

// DI exports (main API)
export * from './di';

// Shared utilities
export * from './shared';

// Meta validation
export * from './meta';

export * from './projection';
export { NodeImportEventSpoolFactory } from './events/NodeImportEventSpool';

// Utils (PG capability detection)
export * from './utils';

export { PostgresComputedReliabilityStore } from './record/computed/reliability/PostgresComputedReliabilityStore';
export type { ComputedReliabilityIssue } from './record/computed/reliability/PostgresComputedReliabilityStore';

export * from './record/computed/reliability/config';

export {
  deleteAttachmentTableRefsByRecordIds,
  listAttachmentTableRefs,
  listAttachmentTokensByTableIds,
  mergeAttachmentTableRefs,
} from './record/attachments/attachmentTableQueries';
export type { AttachmentTableRefRow } from './record/attachments/attachmentTableQueries';
