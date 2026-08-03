export {
  MetaChecker,
  checkTableMeta,
  checkTableMetaWithTables,
  type MetaCheckerOptions,
} from './MetaChecker';

export {
  createMetaValidationContext,
  createMetaValidationContextFromTables,
  type IMetaValidationContext,
} from './MetaValidationContext';

export {
  createMetaRepairer,
  getMetaIssueDetails,
  getMetaRepairHint,
  getMetaRuleId,
  isMetaRuleId,
  MetaRepairer,
  metaRuleDescription,
  metaRuleIdPrefix,
  type MetaRepairerParams,
  type MetaRepairOptions,
  type MetaRepairTarget,
} from './MetaRepairer';

export type {
  MetaValidationCategory,
  MetaValidationSeverity,
  MetaValidationIssue,
  MetaValidationIssueDetails,
  MetaValidationResult,
} from './MetaValidationResult';

export {
  createIssue,
  referenceError,
  schemaError,
  warningIssue,
  infoIssue,
  referenceSuccess,
  schemaSuccess,
} from './MetaValidationResult';

export { MetaValidationVisitor } from './MetaValidationVisitor';
