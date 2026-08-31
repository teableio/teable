import { Field } from '../../fields/Field';
import { FieldType } from '../../fields/FieldType';
import { FieldValueTypeVisitor } from '../../fields/visitors/FieldValueTypeVisitor';
import { CheckboxConditionSpec } from './CheckboxConditionSpec';
import { ConditionalLookupConditionSpec } from './ConditionalLookupConditionSpec';
import type { RecordConditionOperator } from './RecordConditionOperators';
import type { RecordValueConditionSpec } from './RecordConditionSpec';
import {
  isRecordConditionFieldReferenceValue,
  isRecordConditionLiteralListValue,
  isRecordConditionLiteralValue,
  type RecordConditionValue,
} from './RecordConditionValues';

/**
 * How a condition matches when the LHS cell is SQL NULL
 * (including CASE WHEN mask THEN value END when the field is hidden).
 *
 * Align with Postgres predicates in TableRecordConditionWhereVisitor and with
 * the **canonical condition spec** produced by FieldConditionSpecBuilder
 * (e.g. Lookup&lt;Checkbox&gt; → CheckboxConditionSpec).
 *
 * - true: definite WHERE match
 * - false: definite non-match
 * - unknown: three-valued SQL
 * - dynamic: row-dependent (field-reference RHS); callers must fail closed
 */
export type ConditionNullMatch = 'true' | 'false' | 'unknown' | 'dynamic';

const LITERAL_TRUE_ON_NULL = new Set<RecordConditionOperator>(['isEmpty', 'isNot', 'hasNoneOf']);

const ALWAYS_FALSE_ON_NULL = new Set<RecordConditionOperator>(['isNotEmpty']);

/** Positive membership / equality on array-like storage (NULL → `[]` first). */
const ARRAY_LIKE_FALSE_ON_NULL = new Set<RecordConditionOperator>([
  'hasAnyOf',
  'hasAllOf',
  'isExactly',
  'isAnyOf',
  'is',
  'contains',
]);

/** Numeric / date comparisons executed via EXISTS over JSON arrays. */
const ARRAY_LIKE_COMPARISON_OPS = new Set<RecordConditionOperator>([
  'isGreater',
  'isGreaterEqual',
  'isLess',
  'isLessEqual',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
  'isWithIn',
]);

const jsonFieldSpecResult = Field.specs().isJson().build();

const fieldIsJsonForFilter = (field: Field): boolean =>
  jsonFieldSpecResult.isOk() && jsonFieldSpecResult.value.isSatisfiedBy(field);

/**
 * Match SQL visitor `isArrayLikeOutputField`: declared multi OR lookup /
 * conditionalLookup output (forced to arrays for v1 parity).
 */
export const fieldIsArrayLikeForFilter = (field: Field): boolean => {
  const type = field.type();
  if (
    type.equals(FieldType.multipleSelect()) ||
    type.equals(FieldType.attachment()) ||
    type.equals(FieldType.lookup()) ||
    type.equals(FieldType.conditionalLookup())
  ) {
    return true;
  }
  const valueType = field.accept(new FieldValueTypeVisitor());
  if (valueType.isErr()) {
    return false;
  }
  return valueType.value.isMultipleCellValue.isMultiple();
};

const isEmptyLiteralList = (value: RecordConditionValue | undefined): boolean => {
  if (!value || !isRecordConditionLiteralListValue(value)) {
    return false;
  }
  return value.toValues().length === 0;
};

const isEmptyStringLiteral = (value: RecordConditionValue | undefined): boolean =>
  isRecordConditionLiteralValue(value) && value.toValue() === '';

const literalListContainsEmptyString = (value: RecordConditionValue | undefined): boolean =>
  isRecordConditionLiteralListValue(value) && value.toValues().some((item) => item === '');

const checkboxIsFalseNullMatch = (value: RecordConditionValue | undefined): ConditionNullMatch => {
  if (isRecordConditionLiteralValue(value) && value.toValue() === false) {
    return 'true';
  }
  if (isRecordConditionLiteralValue(value) && value.toValue() === true) {
    return 'false';
  }
  return 'false';
};

/**
 * NULL-match for a **canonical** {@link RecordValueConditionSpec} (post
 * FieldConditionSpecBuilder). Prefer this over field+operator alone so Lookup
 * of Checkbox and ConditionalLookup special dispatch stay aligned with SQL.
 */
export const conditionNullMatchForSpec = (
  conditionSpec: RecordValueConditionSpec<RecordConditionOperator>
): ConditionNullMatch => {
  const field = conditionSpec.field();
  const operator = conditionSpec.operator() as RecordConditionOperator;
  const value = conditionSpec.value();

  if (value != null && isRecordConditionFieldReferenceValue(value)) {
    return 'dynamic';
  }

  // CheckboxConditionSpec includes Lookup&lt;Checkbox&gt; (builder uses effective inner type).
  if (conditionSpec instanceof CheckboxConditionSpec) {
    return checkboxIsFalseNullMatch(value);
  }

  // ConditionalLookup: numeric/date operators are dispatched as isEmpty in SQL.
  if (
    conditionSpec instanceof ConditionalLookupConditionSpec &&
    ARRAY_LIKE_COMPARISON_OPS.has(operator)
  ) {
    return 'true';
  }

  return conditionNullMatch(field, operator, value);
};

/**
 * Field + canonical operator/value form (no spec instance). Prefer
 * {@link conditionNullMatchForSpec} when a built condition spec is available.
 */
export const conditionNullMatch = (
  field: Field,
  operator: RecordConditionOperator,
  value?: RecordConditionValue
): ConditionNullMatch => {
  if (value != null && isRecordConditionFieldReferenceValue(value)) {
    return 'dynamic';
  }

  if (operator === 'isEmpty') {
    return 'true';
  }
  if (ALWAYS_FALSE_ON_NULL.has(operator)) {
    return 'false';
  }

  // Physical checkbox only in field-only form (no Lookup unwrapping).
  if (field.type().equals(FieldType.checkbox()) && operator === 'is') {
    return checkboxIsFalseNullMatch(value);
  }

  // Scalar text uses COALESCE(NULL, '') NOT ILIKE '%%' → false.
  // Array/JSON storage checks for matching elements first; [] has none, so NOT(false) → true.
  if (operator === 'doesNotContain') {
    if (
      isEmptyStringLiteral(value) &&
      !fieldIsArrayLikeForFilter(field) &&
      !fieldIsJsonForFilter(field)
    ) {
      return 'false';
    }
    return 'true';
  }

  // Scalar list negatives use COALESCE(NULL, '') NOT IN (...).
  // Array-like storage instead tests membership against [] and remains true.
  if (operator === 'isNoneOf') {
    if (!fieldIsArrayLikeForFilter(field) && literalListContainsEmptyString(value)) {
      return 'false';
    }
    return 'true';
  }

  if (operator === 'isNotExactly') {
    if (isEmptyLiteralList(value)) {
      return 'false';
    }
    if (fieldIsArrayLikeForFilter(field)) {
      return 'true';
    }
    return 'true';
  }

  if (LITERAL_TRUE_ON_NULL.has(operator)) {
    return 'true';
  }

  if (fieldIsArrayLikeForFilter(field)) {
    if (ARRAY_LIKE_FALSE_ON_NULL.has(operator)) {
      return 'false';
    }
    // EXISTS over empty JSON array for numeric/date comparisons.
    if (ARRAY_LIKE_COMPARISON_OPS.has(operator)) {
      // ConditionalLookup comparison→isEmpty is handled in conditionNullMatchForSpec.
      if (field.type().equals(FieldType.conditionalLookup())) {
        return 'true';
      }
      return 'false';
    }
  }

  return 'unknown';
};
