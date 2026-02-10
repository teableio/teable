// Schema (DDL) exports - re-export selectively to avoid conflicts
export type { IV2PostgresDdlAdapterConfig } from './schema';
export { v2PostgresDdlAdapterConfigSchema } from './schema';
export * from './schema/rules';
export * from './schema/repositories';
export * from './schema/naming';

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

// Utils (PG capability detection)
export * from './utils';
