import {
  AbstractFieldVisitor,
  type AttachmentField,
  type AutoNumberField,
  type ButtonField,
  type CheckboxField,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedByField,
  type CreatedTimeField,
  type DateField,
  type DomainError,
  type Field,
  type FormulaField,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LinkField,
  type LongTextField,
  type LookupField,
  type MultipleSelectField,
  type NumberField,
  type RatingField,
  type RollupField,
  type SingleLineTextField,
  type SingleSelectField,
  type UserField,
  FieldValueTypeVisitor,
  CellValueType as DomainCellValueType,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import type { SqlStorageKind, SqlValueType } from './SqlExpression';

export type FieldSqlMetadata = {
  valueType: SqlValueType;
  isArray: boolean;
  storageKind: SqlStorageKind;
};

const mapCellValueType = (cellValueType: DomainCellValueType): SqlValueType => {
  const value = cellValueType.toString();
  switch (value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'dateTime':
      return 'datetime';
    default:
      return 'unknown';
  }
};

class FieldStorageKindVisitor extends AbstractFieldVisitor<SqlStorageKind> {
  visitSingleLineTextField(_field: SingleLineTextField) {
    return this.ok('scalar');
  }

  visitLongTextField(_field: LongTextField) {
    return this.ok('scalar');
  }

  visitNumberField(_field: NumberField) {
    return this.ok('scalar');
  }

  visitRatingField(_field: RatingField) {
    return this.ok('scalar');
  }

  visitFormulaField(_field: FormulaField) {
    return this.ok('scalar');
  }

  visitRollupField(_field: RollupField) {
    return this.ok('scalar');
  }

  visitSingleSelectField(_field: SingleSelectField) {
    return this.ok('scalar');
  }

  visitMultipleSelectField(_field: MultipleSelectField) {
    return this.ok('json');
  }

  visitCheckboxField(_field: CheckboxField) {
    return this.ok('scalar');
  }

  visitAttachmentField(_field: AttachmentField) {
    return this.ok('json');
  }

  visitDateField(_field: DateField) {
    return this.ok('scalar');
  }

  visitCreatedTimeField(_field: CreatedTimeField) {
    return this.ok('scalar');
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeField) {
    return this.ok('scalar');
  }

  visitUserField(_field: UserField) {
    return this.ok('json');
  }

  visitCreatedByField(_field: CreatedByField) {
    return this.ok('json');
  }

  visitLastModifiedByField(_field: LastModifiedByField) {
    return this.ok('json');
  }

  visitAutoNumberField(_field: AutoNumberField) {
    return this.ok('scalar');
  }

  visitButtonField(_field: ButtonField) {
    return this.ok('json');
  }

  visitLinkField(_field: LinkField) {
    return this.ok('json');
  }

  visitLookupField(_field: LookupField) {
    return this.ok('array');
  }

  visitConditionalRollupField(_field: ConditionalRollupField) {
    return this.ok('scalar');
  }

  visitConditionalLookupField(_field: ConditionalLookupField) {
    return this.ok('array');
  }

  private ok(kind: SqlStorageKind) {
    return ok(kind);
  }
}

export const buildFieldSqlMetadata = (field: Field): Result<FieldSqlMetadata, DomainError> => {
  const valueTypeVisitor = new FieldValueTypeVisitor();
  return field.accept(valueTypeVisitor).andThen((valueType) => {
    const storageVisitor = new FieldStorageKindVisitor();
    return field.accept(storageVisitor).map((storageKind) => ({
      valueType: mapCellValueType(valueType.cellValueType),
      isArray: valueType.isMultipleCellValue.toBoolean(),
      storageKind,
    }));
  });
};
