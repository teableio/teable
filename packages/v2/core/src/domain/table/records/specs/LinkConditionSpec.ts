import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../../fields/Field';
import type { ITableRecordConditionSpecVisitor } from './ITableRecordConditionSpecVisitor';
import type { LinkConditionOperator } from './RecordConditionOperators';
import { RecordValueConditionSpec } from './RecordConditionSpec';
import type { RecordConditionValue } from './RecordConditionValues';

export class LinkConditionSpec extends RecordValueConditionSpec<LinkConditionOperator> {
  private constructor(field: Field, operator: LinkConditionOperator, value?: RecordConditionValue) {
    super(field, operator, value);
  }

  static create(
    field: Field,
    operator: LinkConditionOperator,
    value?: RecordConditionValue
  ): LinkConditionSpec {
    return new LinkConditionSpec(field, operator, value);
  }

  accept(v: ITableRecordConditionSpecVisitor): Result<void, DomainError> {
    return match(this.operator())
      .with('is', () => v.visitLinkIs(this).map(() => undefined))
      .with('isNot', () => v.visitLinkIsNot(this).map(() => undefined))
      .with('isAnyOf', () => v.visitLinkIsAnyOf(this).map(() => undefined))
      .with('isNoneOf', () => v.visitLinkIsNoneOf(this).map(() => undefined))
      .with('hasAnyOf', () => v.visitLinkHasAnyOf(this).map(() => undefined))
      .with('hasAllOf', () => v.visitLinkHasAllOf(this).map(() => undefined))
      .with('isExactly', () => v.visitLinkIsExactly(this).map(() => undefined))
      .with('isNotExactly', () => v.visitLinkIsNotExactly(this).map(() => undefined))
      .with('hasNoneOf', () => v.visitLinkHasNoneOf(this).map(() => undefined))
      .with('contains', () => v.visitLinkContains(this).map(() => undefined))
      .with('doesNotContain', () => v.visitLinkDoesNotContain(this).map(() => undefined))
      .with('isEmpty', () => v.visitLinkIsEmpty(this).map(() => undefined))
      .with('isNotEmpty', () => v.visitLinkIsNotEmpty(this).map(() => undefined))
      .exhaustive();
  }
}
