import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { RecordConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class FormulaConditionSpec extends RecordValueConditionSpec<RecordConditionOperator> {
  private constructor(
    field: Field,
    operator: RecordConditionOperator,
    value?: RecordConditionValue
  ) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: RecordConditionOperator,
    value?: RecordConditionValue
  ): FormulaConditionSpec {
    return new FormulaConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitFormulaIs(this).map(() => undefined))
      .with('isNot', () => v.visitFormulaIsNot(this).map(() => undefined))
      .with('contains', () => v.visitFormulaContains(this).map(() => undefined))
      .with('doesNotContain', () => v.visitFormulaDoesNotContain(this).map(() => undefined))
      .with('isEmpty', () => v.visitFormulaIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitFormulaIsNotEmpty(this).map(() => undefined))
      .with('isGreater', () => v.visitFormulaIsGreater(this).map(() => undefined))
      .with('isGreaterEqual', () => v.visitFormulaIsGreaterEqual(this).map(() => undefined))
      .with('isLess', () => v.visitFormulaIsLess(this).map(() => undefined))
      .with('isLessEqual', () => v.visitFormulaIsLessEqual(this).map(() => undefined))
      .with('isAnyOf', () => v.visitFormulaIsAnyOf(this).map(() => undefined))
      .with('isNoneOf', () => v.visitFormulaIsNoneOf(this).map(() => undefined))
      .with('hasAnyOf', () => v.visitFormulaHasAnyOf(this).map(() => undefined))
      .with('hasAllOf', () => v.visitFormulaHasAllOf(this).map(() => undefined))
      .with('isNotExactly', () => v.visitFormulaIsNotExactly(this).map(() => undefined))
      .with('hasNoneOf', () => v.visitFormulaHasNoneOf(this).map(() => undefined))
      .with('isExactly', () => v.visitFormulaIsExactly(this).map(() => undefined))
      .with('isWithIn', () => v.visitFormulaIsWithIn(this).map(() => undefined))
      .with('isBefore', () => v.visitFormulaIsBefore(this).map(() => undefined))
      .with('isAfter', () => v.visitFormulaIsAfter(this).map(() => undefined))
      .with('isOnOrBefore', () => v.visitFormulaIsOnOrBefore(this).map(() => undefined))
      .with('isOnOrAfter', () => v.visitFormulaIsOnOrAfter(this).map(() => undefined))
      .exhaustive();
  }
}
