import type {
  DomainError,
  Field,
  ISpecification,
  ITableSpecVisitor,
  TableAddFieldSpec,
  TableByBaseIdSpec,
  TableByIdSpec,
  TableByIdsSpec,
  TableByNameLikeSpec,
  TableByNameSpec,
  TableRemoveFieldSpec,
  TableUpdateViewColumnMetaSpec,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

export class TableAddFieldCollectorVisitor implements ITableSpecVisitor<void> {
  private readonly fieldsValue: Field[] = [];

  fields(): ReadonlyArray<Field> {
    return [...this.fieldsValue];
  }

  visit(_: ISpecification): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableAddField(spec: TableAddFieldSpec): Result<void, DomainError> {
    this.fieldsValue.push(spec.field());
    return ok(undefined);
  }

  visitTableRemoveField(_spec: TableRemoveFieldSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableUpdateViewColumnMeta(_spec: TableUpdateViewColumnMetaSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByBaseId(_spec: TableByBaseIdSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableById(_spec: TableByIdSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByIds(_spec: TableByIdsSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByName(_spec: TableByNameSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitTableByNameLike(_spec: TableByNameLikeSpec): Result<void, DomainError> {
    return ok(undefined);
  }
}
