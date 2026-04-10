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
export type {
  ISchemaRule,
  SchemaRuleManualRepairOptions,
  SchemaRuleManualRepairValues,
  SchemaRuleRepairHint,
  SchemaRuleValidationResult,
  TableSchemaStatementBuilder,
} from './core';

// Field rules
export {
  ColumnExistsRule,
  ColumnUniqueConstraintRule,
  createFieldSchemaRules,
  FieldMetaRule,
  FieldSchemaRulesVisitor,
  FkColumnRule,
  ForeignKeyRule,
  GeneratedColumnRule,
  IndexRule,
  JunctionTableExistsRule,
  JunctionTableForeignKeyRule,
  JunctionTableIndexRule,
  LinkSymmetricFieldRule,
  LinkValueColumnRule,
  NotNullConstraintRule,
  OrderColumnRule,
  ReferenceRule,
  UniqueIndexRule,
  type FieldSchemaRulesContext,
  type JunctionTableConfig,
  type ReferenceEntry,
} from './field';

// Table rules
export { createSystemTableRules, SYSTEM_RULE_FIELD_ID, SYSTEM_RULE_FIELD_NAME } from './table';

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

// Planner
export {
  calculateRuleDepths,
  createSchemaRulePlanner,
  getSchemaRulePlanningStageDescription,
  SchemaRulePlanner,
  type SchemaRuleFieldPlan,
  type SchemaRulePlanEntry,
  type SchemaRulePlanError,
  type SchemaRulePlannerParams,
  type SchemaRulePlanningStage,
  type SchemaRuleTarget,
} from './planner';

// Checker
export {
  createSchemaChecker,
  getRuleDescription,
  SchemaChecker,
  type SchemaCheckResult,
  type SchemaCheckerParams,
  type SchemaCheckStatus,
} from './checker';

// Repairer
export {
  createSchemaRepairer,
  errorResult,
  pendingResult,
  SchemaRepairer,
  type SchemaRepairDetails,
  type SchemaRepairOutcome,
  type SchemaRepairOptions,
  type SchemaRepairResult,
  type SchemaRepairStatus,
  type SchemaRepairerParams,
} from './repairer';
