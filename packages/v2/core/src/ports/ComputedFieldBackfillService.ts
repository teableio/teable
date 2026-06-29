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
  executeSyncMany(
    context: IExecutionContext,
    input: {
      table: Table;
      fields: ReadonlyArray<Field>;
      skipDistinctFilter?: boolean;
      includeOneManyTwoWay?: boolean;
    }
  ): Promise<Result<ComputedFieldBackfillManyResult, DomainError>>;
}
