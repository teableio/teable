import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { OffsetPagination } from '../../domain/shared/pagination/OffsetPagination';
import type { Sort } from '../../domain/shared/sort/Sort';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Table } from '../../domain/table/Table';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import type { IExecutionContext } from '../ExecutionContext';
import type { IFindOptions } from '../RepositoryQuery';
import type { ITableRepository } from '../TableRepository';

export class MemoryTableRepository implements ITableRepository {
  private readonly savedTables: Table[] = [];

  tables(): ReadonlyArray<Table> {
    return [...this.savedTables];
  }

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, string>> {
    const exists = this.savedTables.some((t) => t.id().equals(table.id()));
    if (exists) return err('Table already exists');
    this.savedTables.push(table);
    return ok(table);
  }

  async findOne(_: IExecutionContext, spec: ISpecification<Table>): Promise<Result<Table, string>> {
    const found = this.savedTables.find((t) => spec.isSatisfiedBy(t));
    if (!found) return err('Not found');
    return ok(found);
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table>,
    options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, string>> {
    const filtered = this.savedTables.filter((t) => spec.isSatisfiedBy(t));
    const sorted = this.applySort(filtered, options?.sort);
    const paginated = this.applyPagination(sorted, options?.pagination);
    return ok(paginated);
  }

  private applySort(tables: ReadonlyArray<Table>, sort?: Sort<TableSortKey>): ReadonlyArray<Table> {
    if (!sort || sort.isEmpty()) return [...tables];
    const sorted = [...tables];
    sorted.sort((left, right) => this.compareTables(left, right, sort));
    return sorted;
  }

  private applyPagination(
    tables: ReadonlyArray<Table>,
    pagination?: OffsetPagination
  ): ReadonlyArray<Table> {
    if (!pagination) return [...tables];
    const offset = pagination.offset().toNumber();
    const limit = pagination.limit().toNumber();
    return tables.slice(offset, offset + limit);
  }

  private compareTables(left: Table, right: Table, sort: Sort<TableSortKey>): number {
    for (const field of sort.fields()) {
      const direction = field.direction.toString();
      const diff = this.compareByKey(left, right, field.key);
      if (diff === 0) continue;
      return direction === 'asc' ? diff : -diff;
    }
    return 0;
  }

  private compareByKey(left: Table, right: Table, key: TableSortKey): number {
    const keyValue = key.toString();
    if (keyValue === 'name') {
      return left.name().toString().localeCompare(right.name().toString());
    }
    if (keyValue === 'id') {
      return left.id().toString().localeCompare(right.id().toString());
    }
    return 0;
  }
}
