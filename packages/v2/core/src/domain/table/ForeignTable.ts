import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../shared/DomainError';
import { ValueObject } from '../shared/ValueObject';
import type { Field } from './fields/Field';
import type { FieldId } from './fields/FieldId';
import type { FieldName } from './fields/FieldName';
import type { Table } from './Table';
import type { TableId } from './TableId';

declare const ForeignTableBrand: unique symbol;

export class ForeignTable extends ValueObject {
  private declare readonly [ForeignTableBrand]: void;

  private constructor(private readonly tableValue: Table) {
    super();
  }

  static from(table: Table): ForeignTable {
    return new ForeignTable(table);
  }

  equals(other: ForeignTable): boolean {
    return this.tableValue.id().equals(other.tableValue.id());
  }

  id(): TableId {
    return this.tableValue.id();
  }

  fieldById(fieldId: FieldId): Result<Field, DomainError> {
    const fieldResult = this.tableValue.getField((candidate) => candidate.id().equals(fieldId));
    if (fieldResult.isErr())
      return err(domainError.notFound({ message: 'Field not found in ForeignTable' }));
    return ok(fieldResult.value);
  }

  generateFieldName(baseName: FieldName): Result<FieldName, DomainError> {
    return this.tableValue.generateFieldName(baseName);
  }
}
