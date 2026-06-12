import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Field } from '../../domain/table/fields/Field';
import type { Table } from '../../domain/table/Table';
import type { IComputedFieldBackfillService } from '../ComputedFieldBackfillService';
import type { IExecutionContext } from '../ExecutionContext';

export class NoopComputedFieldBackfillService implements IComputedFieldBackfillService {
  async executeSyncMany(
    _context: IExecutionContext,
    _input: {
      table: Table;
      fields: ReadonlyArray<Field>;
      skipDistinctFilter?: boolean;
      includeOneManyTwoWay?: boolean;
    }
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}
