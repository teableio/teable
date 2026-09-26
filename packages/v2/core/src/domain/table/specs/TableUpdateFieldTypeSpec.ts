import type { Result } from 'neverthrow';

import { type DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import { Field } from '../fields/Field';
import { FieldType } from '../fields/FieldType';
import { LinkField } from '../fields/types/LinkField';
import { FieldValueTypeVisitor } from '../fields/visitors/FieldValueTypeVisitor';
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

    // A single-value lookup of a link/user/attachment stores jsonb while its
    // cell value type stays string. Retargeting that lookup onto a scalar
    // field (the delete-table path converts the link to text) must alter the
    // column before backfill, or the UPDATE assigns text into jsonb.
    if (this.singleValueLookupJsonStorageChanged()) {
      return true;
    }

    return false;
  }

  private singleValueLookupJsonStorageChanged(): boolean {
    if (!isLookupLike(this.oldFieldValue) || !isLookupLike(this.newFieldValue)) {
      return false;
    }

    const oldMultiple = this.oldFieldValue.isMultipleCellValue();
    const newMultiple = this.newFieldValue.isMultipleCellValue();
    if (
      oldMultiple.isErr() ||
      newMultiple.isErr() ||
      oldMultiple.value.toBoolean() ||
      newMultiple.value.toBoolean()
    ) {
      return false;
    }

    const jsonSpec = Field.specs().isJson().build();
    if (jsonSpec.isErr()) return false;
    return (
      jsonSpec.value.isSatisfiedBy(this.oldFieldValue) !==
      jsonSpec.value.isSatisfiedBy(this.newFieldValue)
    );
  }

  /**
   * Whether data migration is required (most type changes require this)
   */
  requiresDataMigration(): boolean {
    return this.isTypeConversion();
  }

  /**
   * True when the type changes but every stored cell value is preserved
   * verbatim: same storage column, same value domain, no clamping/pruning/
   * parsing. Such conversions need no data migration and no record-level
   * undo/redo snapshot — undoing the meta change alone restores the field.
   *
   * Deliberately a narrow whitelist. A single-select cell stores the option
   * name as text, so converting to a text field keeps the column and every
   * value untouched (V1 ships the same fast path in basalConvert).
   */
  isValuePreservingConversion(): boolean {
    if (!this.isTypeConversion()) {
      return false;
    }

    const oldType = this.oldFieldValue.type().toString();
    const newType = this.newFieldValue.type().toString();
    return oldType === 'singleSelect' && (newType === 'singleLineText' || newType === 'longText');
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.replaceField(this.oldFieldValue.id(), this.newFieldValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateFieldType(this).map(() => undefined);
  }
}

const isLookupLike = (field: Field): boolean => {
  const type = field.type();
  return type.equals(FieldType.lookup()) || type.equals(FieldType.conditionalLookup());
};
