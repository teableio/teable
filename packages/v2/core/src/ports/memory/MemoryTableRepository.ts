import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../ExecutionContext';
import type { ITableRepository } from '../TableRepository';

export class MemoryTableRepository implements ITableRepository {
  private readonly savedTables: Table[] = [];

  tables(): ReadonlyArray<Table> {
    return [...this.savedTables];
  }

  async save(_: IExecutionContext, table: Table): Promise<Result<void, string>> {
    const existingIndex = this.savedTables.findIndex((t) => t.id().equals(table.id()));
    if (existingIndex >= 0) this.savedTables.splice(existingIndex, 1, table);
    else this.savedTables.push(table);
    return ok(undefined);
  }

  async findOne(_: IExecutionContext, spec: ISpecification<Table>): Promise<Result<Table, string>> {
    const found = this.savedTables.find((t) => spec.isSatisfiedBy(t));
    if (!found) return err('Not found');
    return ok(found);
  }
}
