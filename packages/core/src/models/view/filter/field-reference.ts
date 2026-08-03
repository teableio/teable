/* eslint-disable @typescript-eslint/naming-convention */
import { CellValueType, FieldType } from '../../field/constant';
import type { IOperator } from './operator';
import { getValidFilterOperators, isEmpty, isNotEmpty } from './operator';

type FieldShape = {
  cellValueType: CellValueType;
  type: FieldType;
  isMultipleCellValue?: boolean;
};

export type FieldReferenceComparisonKind =
  | 'user'
  | 'link'
  | 'attachment'
  | 'number'
  | 'boolean'
  | 'dateTime'
  | 'string';

const USER_FIELD_TYPES = new Set<FieldType>([
  FieldType.User,
  FieldType.CreatedBy,
  FieldType.LastModifiedBy,
]);

const LINK_FIELD_TYPES = new Set<FieldType>([FieldType.Link]);

const ATTACHMENT_FIELD_TYPES = new Set<FieldType>([FieldType.Attachment]);

export function getFieldReferenceComparisonKind(field: FieldShape): FieldReferenceComparisonKind {
  if (USER_FIELD_TYPES.has(field.type)) {
    return 'user';
  }

  if (LINK_FIELD_TYPES.has(field.type)) {
    return 'link';
  }

  if (ATTACHMENT_FIELD_TYPES.has(field.type)) {
    return 'attachment';
  }

  switch (field.cellValueType) {
    case CellValueType.Number:
      return 'number';
    case CellValueType.Boolean:
      return 'boolean';
    case CellValueType.DateTime:
      return 'dateTime';
    case CellValueType.String:
    default:
      return 'string';
  }
}

export function isFieldReferenceComparable(field: FieldShape, reference: FieldShape): boolean {
  return getFieldReferenceComparisonKind(field) === getFieldReferenceComparisonKind(reference);
}

const FIELD_REFERENCE_UNSUPPORTED_OPERATORS = new Set<IOperator>([isEmpty.value, isNotEmpty.value]);

export function getFieldReferenceSupportedOperators(field: FieldShape): IOperator[] {
  const validOperators = getValidFilterOperators(field);
  return validOperators.filter((op) => !FIELD_REFERENCE_UNSUPPORTED_OPERATORS.has(op));
}

export function isFieldReferenceOperatorSupported(
  field: FieldShape,
  operator?: IOperator | null
): boolean {
  if (!operator) {
    return false;
  }
  if (FIELD_REFERENCE_UNSUPPORTED_OPERATORS.has(operator)) {
    return false;
  }

  const validOperators = getValidFilterOperators(field);
  return validOperators.includes(operator);
}
