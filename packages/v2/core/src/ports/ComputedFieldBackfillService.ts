import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { Field } from '../domain/table/fields/Field';
import type { Table } from '../domain/table/Table';
import type { IExecutionContext } from './ExecutionContext';

/** The computed fields that were actually backfilled (after filtering). */
export type ComputedFieldBackfillManyResult = {
  readonly fields: ReadonlyArray<Field>;
};

export interface IComputedFieldBackfillService {
  /** Complete stored computed values for tables in the same base, in dependency order. */
  executeSyncTables(
    context: IExecutionContext,
    input: {
      tables: ReadonlyArray<Table>;
      skipDistinctFilter?: boolean;
      includeOneManyTwoWay?: boolean;
    }
  ): Promise<Result<void, DomainError>>;
}
