import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import type { Field } from '../../fields/Field';
import type { TableRecord } from '../TableRecord';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { RecordConditionOperator } from './RecordConditionOperators';
import {
  isRecordConditionDateValue,
  isRecordConditionFieldReferenceValue,
  isRecordConditionLiteralListValue,
  isRecordConditionLiteralValue,
  type RecordConditionValue,
  RecordConditionDateValue,
} from './RecordConditionValues';

type Primitive = string | number | boolean;

type ComparisonValue = Primitive | ReadonlyArray<Primitive> | RecordConditionDateValue;

const isPrimitive = (value: unknown): value is Primitive =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const toPrimitiveArray = (value: unknown): ReadonlyArray<Primitive> | undefined => {
  if (Array.isArray(value) && value.every(isPrimitive)) return value;
  if (isPrimitive(value)) return [value];
  return undefined;
};

const isEmptyValue = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const parseTimestamp = (value: unknown): number | undefined => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

const resolveComparisonValue = (
  value: RecordConditionValue,
  record: TableRecord
): ComparisonValue | undefined => {
  if (isRecordConditionLiteralValue(value)) return value.toValue();
  if (isRecordConditionLiteralListValue(value)) return value.toValues();
  if (isRecordConditionDateValue(value)) return value;
  if (isRecordConditionFieldReferenceValue(value)) {
    const fieldValue = record.fields().get(value.field().id())?.toValue();
    if (Array.isArray(fieldValue) && fieldValue.every(isPrimitive)) return fieldValue;
    if (isPrimitive(fieldValue)) return fieldValue;
    return undefined;
  }
  return undefined;
};

const evaluateArrayOperator = (
  operator: RecordConditionOperator,
  recordValue: unknown,
  comparisonValues: ReadonlyArray<Primitive>
): boolean => {
  const recordValues = toPrimitiveArray(recordValue);
  if (!recordValues) return false;

  const recordSet = new Set(recordValues);
  const comparisonSet = new Set(comparisonValues);

  switch (operator) {
    case 'isAnyOf':
    case 'hasAnyOf':
      return comparisonValues.some((value) => recordSet.has(value));
    case 'isNoneOf':
    case 'hasNoneOf':
      return comparisonValues.every((value) => !recordSet.has(value));
    case 'hasAllOf':
      return comparisonValues.every((value) => recordSet.has(value));
    case 'isExactly':
      if (recordSet.size !== comparisonSet.size) return false;
      return comparisonValues.every((value) => recordSet.has(value));
    case 'isNotExactly':
      if (recordSet.size !== comparisonSet.size) return true;
      return comparisonValues.some((value) => !recordSet.has(value));
    default:
      return false;
  }
};

const evaluateScalarOperator = (
  operator: RecordConditionOperator,
  recordValue: unknown,
  comparisonValue: Primitive
): boolean => {
  if (operator === 'is') return Object.is(recordValue, comparisonValue);
  if (operator === 'isNot') return !Object.is(recordValue, comparisonValue);

  if (operator === 'contains' || operator === 'doesNotContain') {
    if (typeof recordValue !== 'string' || typeof comparisonValue !== 'string') return false;
    const contains = recordValue.includes(comparisonValue);
    return operator === 'contains' ? contains : !contains;
  }

  if (
    operator === 'isGreater' ||
    operator === 'isGreaterEqual' ||
    operator === 'isLess' ||
    operator === 'isLessEqual'
  ) {
    if (typeof recordValue !== 'number' || typeof comparisonValue !== 'number') return false;
    if (operator === 'isGreater') return recordValue > comparisonValue;
    if (operator === 'isGreaterEqual') return recordValue >= comparisonValue;
    if (operator === 'isLess') return recordValue < comparisonValue;
    return recordValue <= comparisonValue;
  }

  if (
    operator === 'isBefore' ||
    operator === 'isAfter' ||
    operator === 'isOnOrBefore' ||
    operator === 'isOnOrAfter'
  ) {
    const recordTimestamp = parseTimestamp(recordValue);
    const comparisonTimestamp = parseTimestamp(comparisonValue);
    if (recordTimestamp == null || comparisonTimestamp == null) return false;
    if (operator === 'isBefore') return recordTimestamp < comparisonTimestamp;
    if (operator === 'isAfter') return recordTimestamp > comparisonTimestamp;
    if (operator === 'isOnOrBefore') return recordTimestamp <= comparisonTimestamp;
    return recordTimestamp >= comparisonTimestamp;
  }

  return false;
};

const evaluateDateCondition = (
  operator: RecordConditionOperator,
  recordValue: unknown,
  condition: RecordConditionDateValue
): boolean => {
  const recordTimestamp = parseTimestamp(recordValue);
  if (recordTimestamp == null) return false;

  const exactDate = condition.exactDate();
  const exactTimestamp = exactDate ? parseTimestamp(exactDate) : undefined;

  if (operator === 'is' || operator === 'isNot') {
    if (exactTimestamp == null) return false;
    const matches = recordTimestamp === exactTimestamp;
    return operator === 'is' ? matches : !matches;
  }

  if (
    operator === 'isBefore' ||
    operator === 'isAfter' ||
    operator === 'isOnOrBefore' ||
    operator === 'isOnOrAfter'
  ) {
    if (exactTimestamp == null) return false;
    if (operator === 'isBefore') return recordTimestamp < exactTimestamp;
    if (operator === 'isAfter') return recordTimestamp > exactTimestamp;
    if (operator === 'isOnOrBefore') return recordTimestamp <= exactTimestamp;
    return recordTimestamp >= exactTimestamp;
  }

  return false;
};

const evaluateRecordCondition = (
  operator: RecordConditionOperator,
  recordValue: unknown,
  value: RecordConditionValue | undefined,
  record: TableRecord
): boolean => {
  if (operator === 'isEmpty') return isEmptyValue(recordValue);
  if (operator === 'isNotEmpty') return !isEmptyValue(recordValue);
  if (!value) return false;

  const comparisonValue = resolveComparisonValue(value, record);
  if (comparisonValue === undefined) return false;

  if (comparisonValue instanceof RecordConditionDateValue) {
    return evaluateDateCondition(operator, recordValue, comparisonValue);
  }

  if (Array.isArray(comparisonValue)) {
    return evaluateArrayOperator(operator, recordValue, comparisonValue);
  }

  return evaluateScalarOperator(operator, recordValue, comparisonValue as Primitive);
};

export abstract class RecordConditionSpec<
  V extends ITableRecordConditionSpecVisitor = ITableRecordConditionSpecVisitor,
> implements ISpecification<TableRecord, V>
{
  protected constructor(private readonly fieldValue: Field) {}

  field(): Field {
    return this.fieldValue;
  }

  mutate(t: TableRecord): Result<TableRecord, DomainError> {
    return ok(t);
  }

  abstract isSatisfiedBy(t: TableRecord): boolean;
  abstract accept(v: V): Result<void, DomainError>;
}

export abstract class RecordValueConditionSpec<
  TOperator extends RecordConditionOperator,
  V extends ITableRecordConditionSpecVisitor = ITableRecordConditionSpecVisitor,
> extends RecordConditionSpec<V> {
  protected constructor(
    field: Field,
    private readonly operatorValue: TOperator,
    private readonly valueValue?: RecordConditionValue
  ) {
    super(field);
  }

  operator(): TOperator {
    return this.operatorValue;
  }

  value(): RecordConditionValue | undefined {
    return this.valueValue;
  }

  isSatisfiedBy(record: TableRecord): boolean {
    const fieldValue = record.fields().get(this.field().id());
    const recordValue = fieldValue ? fieldValue.toValue() : undefined;
    return evaluateRecordCondition(this.operatorValue, recordValue, this.valueValue, record);
  }
}
