import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import { LinkField } from '../fields/types/LinkField';
import { FieldValueTypeVisitor } from '../fields/visitors/FieldValueTypeVisitor';
import type { Field } from '../fields/Field';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Specification for field type conversion.
 * Stores both old field and new field for repository to generate conversion SQL.
 */
export class TableUpdateFieldTypeSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly oldFieldValue: Field,
    private readonly newFieldValue: Field
  ) {
    super();
  }

  static create(oldField: Field, newField: Field): TableUpdateFieldTypeSpec {
    // Preserve the old field's dbFieldName on the new field.
    // The physical column name doesn't change during field updates, but
    // create()/createPending() typically produce fields without dbFieldName.
    // Without this, the persistence builder would derive a new name from the
    // (possibly renamed) field name, causing column-not-found errors in
    // downstream backfill queries.
    const dbNameResult = oldField.dbFieldName();
    if (dbNameResult.isOk()) {
      newField.setDbFieldName(dbNameResult.value);
    }
    return new TableUpdateFieldTypeSpec(oldField, newField);
  }

  oldField(): Field {
    return this.oldFieldValue;
  }

  newField(): Field {
    return this.newFieldValue;
  }

  /**
   * Whether this represents a type change (vs just options change on same type)
   */
  isTypeConversion(): boolean {
    if (!this.oldFieldValue.type().equals(this.newFieldValue.type())) {
      return true;
    }

    const valueTypeVisitor = new FieldValueTypeVisitor();
    const oldValueTypeResult = this.oldFieldValue.accept(valueTypeVisitor);
    const newValueTypeResult = this.newFieldValue.accept(valueTypeVisitor);
    if (oldValueTypeResult.isErr() || newValueTypeResult.isErr()) {
      return false;
    }

    const oldValueType = oldValueTypeResult.value;
    const newValueType = newValueTypeResult.value;
    if (
      !oldValueType.cellValueType.equals(newValueType.cellValueType) ||
      !oldValueType.isMultipleCellValue.equals(newValueType.isMultipleCellValue)
    ) {
      return true;
    }

    if (this.oldFieldValue instanceof LinkField && this.newFieldValue instanceof LinkField) {
      if (!this.oldFieldValue.foreignTableId().equals(this.newFieldValue.foreignTableId())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Whether data migration is required (most type changes require this)
   */
  requiresDataMigration(): boolean {
    return this.isTypeConversion();
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.replaceField(this.oldFieldValue.id(), this.newFieldValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateFieldType(this).map(() => undefined);
  }
}
