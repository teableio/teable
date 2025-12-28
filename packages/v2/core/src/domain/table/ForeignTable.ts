import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

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

  fieldById(fieldId: FieldId): Result<Field, string> {
    const field = this.tableValue.fields().find((candidate) => candidate.id().equals(fieldId));
    if (!field) return err('Field not found in ForeignTable');
    return ok(field);
  }

  generateFieldName(baseName: FieldName): Result<FieldName, string> {
    return this.tableValue.generateFieldName(baseName);
  }
}
