import type { SchemaRuleDetailItem, SchemaRuleRepairHint } from '../core/ISchemaRule';

export type SchemaRepairStatus = 'success' | 'error' | 'warn' | 'pending' | 'running' | 'skipped';

export type SchemaRepairOutcome = 'repaired' | 'unchanged' | 'manual' | 'skipped';

export interface SchemaRepairDetails {
  missing?: ReadonlyArray<string>;
  missingItems?: ReadonlyArray<SchemaRuleDetailItem>;
  extra?: ReadonlyArray<string>;
  extraItems?: ReadonlyArray<SchemaRuleDetailItem>;
  statementCount?: number;
  statements?: ReadonlyArray<SchemaRepairSqlStatement>;
}

export interface SchemaRepairSqlStatement {
  sql: string;
  parameters: ReadonlyArray<unknown>;
}

export interface SchemaRepairResult {
  id: string;
  fieldId: string;
  fieldName: string;
  ruleId: string;
  ruleDescription: string;
  status: SchemaRepairStatus;
  outcome?: SchemaRepairOutcome;
  message?: string;
  details?: SchemaRepairDetails;
  repair?: SchemaRuleRepairHint;
  required: boolean;
  timestamp: number;
  dependencies: ReadonlyArray<string>;
  depth: number;
}

export const pendingResult = (
  fieldId: string,
  fieldName: string,
  ruleId: string,
  ruleDescription: string,
  required: boolean,
  dependencies: ReadonlyArray<string> = [],
  depth: number = 0
): SchemaRepairResult => ({
  id: `${fieldId}:${ruleId}`,
  fieldId,
  fieldName,
  ruleId,
  ruleDescription,
  status: 'pending',
  required,
  timestamp: Date.now(),
  dependencies,
  depth,
});

export const runningResult = (pending: SchemaRepairResult): SchemaRepairResult => ({
  ...pending,
  status: 'running',
  timestamp: Date.now(),
});

export const successResult = (
  pending: SchemaRepairResult,
  message: string,
  outcome: Extract<SchemaRepairOutcome, 'repaired' | 'unchanged'>,
  details?: SchemaRepairDetails
): SchemaRepairResult => ({
  ...pending,
  status: 'success',
  outcome,
  message,
  details,
  timestamp: Date.now(),
});

export const warnResult = (
  pending: SchemaRepairResult,
  message: string,
  outcome: Extract<SchemaRepairOutcome, 'manual'>,
  details?: SchemaRepairDetails
): SchemaRepairResult => ({
  ...pending,
  status: 'warn',
  outcome,
  message,
  details,
  timestamp: Date.now(),
});

export const skippedResult = (
  pending: SchemaRepairResult,
  message: string,
  details?: SchemaRepairDetails
): SchemaRepairResult => ({
  ...pending,
  status: 'skipped',
  outcome: 'skipped',
  message,
  details,
  timestamp: Date.now(),
});

export const errorResult = (
  pending: SchemaRepairResult,
  message: string,
  details?: SchemaRepairDetails
): SchemaRepairResult => ({
  ...pending,
  status: 'error',
  message,
  details,
  timestamp: Date.now(),
});
