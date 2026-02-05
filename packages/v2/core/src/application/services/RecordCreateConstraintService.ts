import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  IRecordCreateConstraint,
  IRecordCreateConstraintService,
} from '../../ports/RecordCreateConstraintService';

export class RecordCreateConstraintService implements IRecordCreateConstraintService {
  constructor(private readonly constraints: IRecordCreateConstraint[]) {}

  register(constraint: IRecordCreateConstraint): void {
    this.constraints.push(constraint);
  }

  async checkCreate(
    context: IExecutionContext,
    tableId: TableId,
    recordCount: number
  ): Promise<Result<void, DomainError>> {
    if (!this.constraints.length || recordCount <= 0) return ok(undefined);

    const results = await Promise.all(
      this.constraints.map((constraint) => constraint.checkCreate(context, tableId, recordCount))
    );

    for (const result of results) {
      if (result.isErr()) return err(result.error);
    }

    return ok(undefined);
  }
}
