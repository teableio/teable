// Context
export {
  createSchemaRuleContext,
  PostgresSchemaIntrospector,
  type ColumnInfo,
  type ConstraintInfo,
  type ForeignKeyInfo,
  type IndexInfo,
  type SchemaIntrospector,
  type SchemaRuleContext,
} from './context';

// Core interfaces
export type { ISchemaRule, SchemaRuleValidationResult, TableSchemaStatementBuilder } from './core';

// Field rules
export {
  ColumnRule,
  createFieldSchemaRules,
  FieldMetaRule,
  FieldSchemaRulesVisitor,
  FkColumnRule,
  ForeignKeyRule,
  GeneratedColumnRule,
  IndexRule,
  JunctionTableRule,
  LinkValueColumnRule,
  OrderColumnRule,
  ReferenceRule,
  UniqueIndexRule,
  type FieldSchemaRulesContext,
  type JunctionTableConfig,
  type ReferenceEntry,
} from './field';

// Helpers
export {
  addGeneratedColumnStatement,
  buildTableIdentifier,
  compressSql,
  createForeignKeyConstraintStatement,
  createIndexStatement,
  createUniqueIndexStatement,
  dropColumnStatement,
  dropConstraintStatement,
  dropIndexStatement,
  dropTableStatement,
  type TableIdentifier,
} from './helpers';

// Resolver
export {
  SchemaRuleResolver,
  schemaRuleResolver,
  type ISchemaRuleResolver,
  type RuleResolutionResult,
} from './resolver';

// Checker
export {
  createSchemaChecker,
  getRuleDescription,
  SchemaChecker,
  type SchemaCheckResult,
  type SchemaCheckerParams,
  type SchemaCheckStatus,
} from './checker';
