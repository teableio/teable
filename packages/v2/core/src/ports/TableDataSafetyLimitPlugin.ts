import type { Result } from 'neverthrow';

import type { TableDataSafetyLimitConfig } from '../domain/shared/TableDataSafetyLimits';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from './ExecutionContext';

export type TableDataSafetyLimitPluginResult =
  | Result<TableDataSafetyLimitConfig | undefined, DomainError>
  | Promise<Result<TableDataSafetyLimitConfig | undefined, DomainError>>;

export interface ITableDataSafetyLimitPlugin {
  readonly name: string;

  contribute(context: IExecutionContext): TableDataSafetyLimitPluginResult;
}
