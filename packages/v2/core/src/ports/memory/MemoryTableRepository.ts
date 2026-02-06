import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { OffsetPagination } from '../../domain/shared/pagination/OffsetPagination';
import type { Sort } from '../../domain/shared/sort/Sort';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import type { IExecutionContext } from '../ExecutionContext';
import type { IFindOptions } from '../RepositoryQuery';
import type { ITableRepository } from '../TableRepository';

export class MemoryTableRepository implements ITableRepository {
  private readonly savedTables: Table[] = [];
  private readonly createdSequenceById = new Map<string, number>();
  private createdSequence = 0;

  tables(): ReadonlyArray<Table> {
    return [...this.savedTables];
  }

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    const exists = this.savedTables.some((t) => t.id().equals(table.id()));
    if (exists) return err(domainError.conflict({ message: 'Table already exists' }));
    this.savedTables.push(table);
    this.createdSequenceById.set(table.id().toString(), this.createdSequence);
    this.createdSequence += 1;
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    for (const table of tables) {
      const exists = this.savedTables.some((t) => t.id().equals(table.id()));
      if (exists) return err(domainError.conflict({ message: 'Table already exists' }));
    }
    for (const table of tables) {
      this.savedTables.push(table);
      this.createdSequenceById.set(table.id().toString(), this.createdSequence);
      this.createdSequence += 1;
    }
    return ok([...tables]);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    const found = this.savedTables.find((t) => spec.isSatisfiedBy(t));
    if (!found) return err(domainError.notFound({ message: 'Not found' }));
    return ok(found);
  }

  async find(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    const filtered = this.savedTables.filter((t) => spec.isSatisfiedBy(t));
    const sorted = this.applySort(filtered, options?.sort);
    const paginated = this.applyPagination(sorted, options?.pagination);
    return ok(paginated);
  }

  async updateOne(
    _: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const index = this.savedTables.findIndex((t) => t.id().equals(table.id()));
    if (index === -1) return err(domainError.notFound({ message: 'Not found' }));
    const current = this.savedTables[index];
    const mutateResult = mutateSpec.mutate(current);
    if (mutateResult.isErr()) return err(mutateResult.error);
    this.savedTables[index] = table;
    return ok(undefined);
  }

  async delete(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    const index = this.savedTables.findIndex((t) => t.id().equals(table.id()));
    if (index === -1) return err(domainError.notFound({ message: 'Not found' }));
    this.savedTables.splice(index, 1);
    this.createdSequenceById.delete(table.id().toString());
    return ok(undefined);
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
    if (keyValue === 'createdTime') {
      const leftOrder = this.createdSequenceById.get(left.id().toString()) ?? 0;
      const rightOrder = this.createdSequenceById.get(right.id().toString()) ?? 0;
      return leftOrder - rightOrder;
    }
    return 0;
  }
}
