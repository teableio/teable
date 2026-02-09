import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { AttachmentConditionSpec } from './AttachmentConditionSpec';
import type { ButtonConditionSpec } from './ButtonConditionSpec';
import type { CheckboxConditionSpec } from './CheckboxConditionSpec';
import type { ConditionalLookupConditionSpec } from './ConditionalLookupConditionSpec';
import type { ConditionalRollupConditionSpec } from './ConditionalRollupConditionSpec';
import type { DateConditionSpec } from './DateConditionSpec';
import type { FormulaConditionSpec } from './FormulaConditionSpec';
import type { LinkConditionSpec } from './LinkConditionSpec';
import type { LongTextConditionSpec } from './LongTextConditionSpec';
import type { MultipleSelectConditionSpec } from './MultipleSelectConditionSpec';
import type { NumberConditionSpec } from './NumberConditionSpec';
import type { RatingConditionSpec } from './RatingConditionSpec';
import type { RecordByIdSpec } from './RecordByIdSpec';
import type { RecordByIdsSpec } from './RecordByIdsSpec';
import type { RollupConditionSpec } from './RollupConditionSpec';
import type { SingleLineTextConditionSpec } from './SingleLineTextConditionSpec';
import type { SingleSelectConditionSpec } from './SingleSelectConditionSpec';
import type { UserConditionSpec } from './UserConditionSpec';

export interface ITableRecordConditionSpecVisitor<TResult = unknown> extends ISpecVisitor {
  visitRecordById(spec: RecordByIdSpec): Result<TResult, DomainError>;
  visitRecordByIds(spec: RecordByIdsSpec): Result<TResult, DomainError>;

  visitSingleLineTextIs(spec: SingleLineTextConditionSpec): Result<TResult, DomainError>;
  visitSingleLineTextIsNot(spec: SingleLineTextConditionSpec): Result<TResult, DomainError>;
  visitSingleLineTextContains(spec: SingleLineTextConditionSpec): Result<TResult, DomainError>;
  visitSingleLineTextDoesNotContain(
    spec: SingleLineTextConditionSpec
  ): Result<TResult, DomainError>;
  visitSingleLineTextIsEmpty(spec: SingleLineTextConditionSpec): Result<TResult, DomainError>;
  visitSingleLineTextIsNotEmpty(spec: SingleLineTextConditionSpec): Result<TResult, DomainError>;

  visitLongTextIs(spec: LongTextConditionSpec): Result<TResult, DomainError>;
  visitLongTextIsNot(spec: LongTextConditionSpec): Result<TResult, DomainError>;
  visitLongTextContains(spec: LongTextConditionSpec): Result<TResult, DomainError>;
  visitLongTextDoesNotContain(spec: LongTextConditionSpec): Result<TResult, DomainError>;
  visitLongTextIsEmpty(spec: LongTextConditionSpec): Result<TResult, DomainError>;
  visitLongTextIsNotEmpty(spec: LongTextConditionSpec): Result<TResult, DomainError>;

  visitButtonIs(spec: ButtonConditionSpec): Result<TResult, DomainError>;
  visitButtonIsNot(spec: ButtonConditionSpec): Result<TResult, DomainError>;
  visitButtonContains(spec: ButtonConditionSpec): Result<TResult, DomainError>;
  visitButtonDoesNotContain(spec: ButtonConditionSpec): Result<TResult, DomainError>;
  visitButtonIsEmpty(spec: ButtonConditionSpec): Result<TResult, DomainError>;
  visitButtonIsNotEmpty(spec: ButtonConditionSpec): Result<TResult, DomainError>;

  visitNumberIs(spec: NumberConditionSpec): Result<TResult, DomainError>;
  visitNumberIsNot(spec: NumberConditionSpec): Result<TResult, DomainError>;
  visitNumberIsGreater(spec: NumberConditionSpec): Result<TResult, DomainError>;
  visitNumberIsGreaterEqual(spec: NumberConditionSpec): Result<TResult, DomainError>;
  visitNumberIsLess(spec: NumberConditionSpec): Result<TResult, DomainError>;
  visitNumberIsLessEqual(spec: NumberConditionSpec): Result<TResult, DomainError>;
  visitNumberIsEmpty(spec: NumberConditionSpec): Result<TResult, DomainError>;
  visitNumberIsNotEmpty(spec: NumberConditionSpec): Result<TResult, DomainError>;

  visitRatingIs(spec: RatingConditionSpec): Result<TResult, DomainError>;
  visitRatingIsNot(spec: RatingConditionSpec): Result<TResult, DomainError>;
  visitRatingIsGreater(spec: RatingConditionSpec): Result<TResult, DomainError>;
  visitRatingIsGreaterEqual(spec: RatingConditionSpec): Result<TResult, DomainError>;
  visitRatingIsLess(spec: RatingConditionSpec): Result<TResult, DomainError>;
  visitRatingIsLessEqual(spec: RatingConditionSpec): Result<TResult, DomainError>;
  visitRatingIsEmpty(spec: RatingConditionSpec): Result<TResult, DomainError>;
  visitRatingIsNotEmpty(spec: RatingConditionSpec): Result<TResult, DomainError>;

  visitCheckboxIs(spec: CheckboxConditionSpec): Result<TResult, DomainError>;

  visitDateIs(spec: DateConditionSpec): Result<TResult, DomainError>;
  visitDateIsNot(spec: DateConditionSpec): Result<TResult, DomainError>;
  visitDateIsWithIn(spec: DateConditionSpec): Result<TResult, DomainError>;
  visitDateIsBefore(spec: DateConditionSpec): Result<TResult, DomainError>;
  visitDateIsAfter(spec: DateConditionSpec): Result<TResult, DomainError>;
  visitDateIsOnOrBefore(spec: DateConditionSpec): Result<TResult, DomainError>;
  visitDateIsOnOrAfter(spec: DateConditionSpec): Result<TResult, DomainError>;
  visitDateIsEmpty(spec: DateConditionSpec): Result<TResult, DomainError>;
  visitDateIsNotEmpty(spec: DateConditionSpec): Result<TResult, DomainError>;

  visitSingleSelectIs(spec: SingleSelectConditionSpec): Result<TResult, DomainError>;
  visitSingleSelectIsNot(spec: SingleSelectConditionSpec): Result<TResult, DomainError>;
  visitSingleSelectIsAnyOf(spec: SingleSelectConditionSpec): Result<TResult, DomainError>;
  visitSingleSelectIsNoneOf(spec: SingleSelectConditionSpec): Result<TResult, DomainError>;
  visitSingleSelectIsEmpty(spec: SingleSelectConditionSpec): Result<TResult, DomainError>;
  visitSingleSelectIsNotEmpty(spec: SingleSelectConditionSpec): Result<TResult, DomainError>;

  visitMultipleSelectHasAnyOf(spec: MultipleSelectConditionSpec): Result<TResult, DomainError>;
  visitMultipleSelectHasAllOf(spec: MultipleSelectConditionSpec): Result<TResult, DomainError>;
  visitMultipleSelectIsExactly(spec: MultipleSelectConditionSpec): Result<TResult, DomainError>;
  visitMultipleSelectIsNotExactly(spec: MultipleSelectConditionSpec): Result<TResult, DomainError>;
  visitMultipleSelectHasNoneOf(spec: MultipleSelectConditionSpec): Result<TResult, DomainError>;
  visitMultipleSelectIsEmpty(spec: MultipleSelectConditionSpec): Result<TResult, DomainError>;
  visitMultipleSelectIsNotEmpty(spec: MultipleSelectConditionSpec): Result<TResult, DomainError>;

  visitAttachmentIsEmpty(spec: AttachmentConditionSpec): Result<TResult, DomainError>;
  visitAttachmentIsNotEmpty(spec: AttachmentConditionSpec): Result<TResult, DomainError>;

  visitUserIs(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserIsNot(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserIsAnyOf(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserIsNoneOf(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserHasAnyOf(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserHasAllOf(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserIsExactly(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserIsNotExactly(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserHasNoneOf(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserIsEmpty(spec: UserConditionSpec): Result<TResult, DomainError>;
  visitUserIsNotEmpty(spec: UserConditionSpec): Result<TResult, DomainError>;

  visitLinkIs(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkIsNot(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkIsAnyOf(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkIsNoneOf(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkHasAnyOf(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkHasAllOf(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkIsExactly(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkIsNotExactly(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkHasNoneOf(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkContains(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkDoesNotContain(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkIsEmpty(spec: LinkConditionSpec): Result<TResult, DomainError>;
  visitLinkIsNotEmpty(spec: LinkConditionSpec): Result<TResult, DomainError>;

  visitFormulaIs(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsNot(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaContains(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaDoesNotContain(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsEmpty(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsNotEmpty(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsGreater(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsGreaterEqual(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsLess(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsLessEqual(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsAnyOf(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsNoneOf(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaHasAnyOf(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaHasAllOf(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsNotExactly(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaHasNoneOf(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsExactly(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsWithIn(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsBefore(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsAfter(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsOnOrBefore(spec: FormulaConditionSpec): Result<TResult, DomainError>;
  visitFormulaIsOnOrAfter(spec: FormulaConditionSpec): Result<TResult, DomainError>;

  visitRollupIs(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsNot(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupContains(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupDoesNotContain(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsEmpty(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsNotEmpty(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsGreater(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsGreaterEqual(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsLess(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsLessEqual(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsAnyOf(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsNoneOf(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupHasAnyOf(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupHasAllOf(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsNotExactly(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupHasNoneOf(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsExactly(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsWithIn(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsBefore(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsAfter(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsOnOrBefore(spec: RollupConditionSpec): Result<TResult, DomainError>;
  visitRollupIsOnOrAfter(spec: RollupConditionSpec): Result<TResult, DomainError>;

  // ConditionalRollup condition specs (similar to Rollup)
  visitConditionalRollupIs(spec: ConditionalRollupConditionSpec): Result<TResult, DomainError>;
  visitConditionalRollupIsNot(spec: ConditionalRollupConditionSpec): Result<TResult, DomainError>;
  visitConditionalRollupContains(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupDoesNotContain(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsEmpty(spec: ConditionalRollupConditionSpec): Result<TResult, DomainError>;
  visitConditionalRollupIsNotEmpty(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsGreater(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsGreaterEqual(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsLess(spec: ConditionalRollupConditionSpec): Result<TResult, DomainError>;
  visitConditionalRollupIsLessEqual(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsAnyOf(spec: ConditionalRollupConditionSpec): Result<TResult, DomainError>;
  visitConditionalRollupIsNoneOf(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupHasAnyOf(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupHasAllOf(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsNotExactly(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupHasNoneOf(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsExactly(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsWithIn(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsBefore(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsAfter(spec: ConditionalRollupConditionSpec): Result<TResult, DomainError>;
  visitConditionalRollupIsOnOrBefore(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalRollupIsOnOrAfter(
    spec: ConditionalRollupConditionSpec
  ): Result<TResult, DomainError>;

  // ConditionalLookup condition specs
  visitConditionalLookupIs(spec: ConditionalLookupConditionSpec): Result<TResult, DomainError>;
  visitConditionalLookupIsNot(spec: ConditionalLookupConditionSpec): Result<TResult, DomainError>;
  visitConditionalLookupContains(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalLookupDoesNotContain(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalLookupIsEmpty(spec: ConditionalLookupConditionSpec): Result<TResult, DomainError>;
  visitConditionalLookupIsNotEmpty(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalLookupIsAnyOf(spec: ConditionalLookupConditionSpec): Result<TResult, DomainError>;
  visitConditionalLookupIsNoneOf(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalLookupHasAnyOf(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalLookupHasAllOf(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalLookupIsNotExactly(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalLookupHasNoneOf(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
  visitConditionalLookupIsExactly(
    spec: ConditionalLookupConditionSpec
  ): Result<TResult, DomainError>;
}
