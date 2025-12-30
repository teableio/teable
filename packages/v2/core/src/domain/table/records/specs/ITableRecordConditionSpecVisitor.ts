import type { Result } from 'neverthrow';

import type { ISpecVisitor } from '../../../shared/specification/ISpecVisitor';
import type { AttachmentConditionSpec } from './AttachmentConditionSpec';
import type { ButtonConditionSpec } from './ButtonConditionSpec';
import type { CheckboxConditionSpec } from './CheckboxConditionSpec';
import type { DateConditionSpec } from './DateConditionSpec';
import type { FormulaConditionSpec } from './FormulaConditionSpec';
import type { LinkConditionSpec } from './LinkConditionSpec';
import type { LongTextConditionSpec } from './LongTextConditionSpec';
import type { MultipleSelectConditionSpec } from './MultipleSelectConditionSpec';
import type { NumberConditionSpec } from './NumberConditionSpec';
import type { RatingConditionSpec } from './RatingConditionSpec';
import type { RollupConditionSpec } from './RollupConditionSpec';
import type { SingleLineTextConditionSpec } from './SingleLineTextConditionSpec';
import type { SingleSelectConditionSpec } from './SingleSelectConditionSpec';
import type { UserConditionSpec } from './UserConditionSpec';

export interface ITableRecordConditionSpecVisitor<TResult = unknown> extends ISpecVisitor {
  visitSingleLineTextIs(spec: SingleLineTextConditionSpec): Result<TResult, string>;
  visitSingleLineTextIsNot(spec: SingleLineTextConditionSpec): Result<TResult, string>;
  visitSingleLineTextContains(spec: SingleLineTextConditionSpec): Result<TResult, string>;
  visitSingleLineTextDoesNotContain(spec: SingleLineTextConditionSpec): Result<TResult, string>;
  visitSingleLineTextIsEmpty(spec: SingleLineTextConditionSpec): Result<TResult, string>;
  visitSingleLineTextIsNotEmpty(spec: SingleLineTextConditionSpec): Result<TResult, string>;

  visitLongTextIs(spec: LongTextConditionSpec): Result<TResult, string>;
  visitLongTextIsNot(spec: LongTextConditionSpec): Result<TResult, string>;
  visitLongTextContains(spec: LongTextConditionSpec): Result<TResult, string>;
  visitLongTextDoesNotContain(spec: LongTextConditionSpec): Result<TResult, string>;
  visitLongTextIsEmpty(spec: LongTextConditionSpec): Result<TResult, string>;
  visitLongTextIsNotEmpty(spec: LongTextConditionSpec): Result<TResult, string>;

  visitButtonIs(spec: ButtonConditionSpec): Result<TResult, string>;
  visitButtonIsNot(spec: ButtonConditionSpec): Result<TResult, string>;
  visitButtonContains(spec: ButtonConditionSpec): Result<TResult, string>;
  visitButtonDoesNotContain(spec: ButtonConditionSpec): Result<TResult, string>;
  visitButtonIsEmpty(spec: ButtonConditionSpec): Result<TResult, string>;
  visitButtonIsNotEmpty(spec: ButtonConditionSpec): Result<TResult, string>;

  visitNumberIs(spec: NumberConditionSpec): Result<TResult, string>;
  visitNumberIsNot(spec: NumberConditionSpec): Result<TResult, string>;
  visitNumberIsGreater(spec: NumberConditionSpec): Result<TResult, string>;
  visitNumberIsGreaterEqual(spec: NumberConditionSpec): Result<TResult, string>;
  visitNumberIsLess(spec: NumberConditionSpec): Result<TResult, string>;
  visitNumberIsLessEqual(spec: NumberConditionSpec): Result<TResult, string>;
  visitNumberIsEmpty(spec: NumberConditionSpec): Result<TResult, string>;
  visitNumberIsNotEmpty(spec: NumberConditionSpec): Result<TResult, string>;

  visitRatingIs(spec: RatingConditionSpec): Result<TResult, string>;
  visitRatingIsNot(spec: RatingConditionSpec): Result<TResult, string>;
  visitRatingIsGreater(spec: RatingConditionSpec): Result<TResult, string>;
  visitRatingIsGreaterEqual(spec: RatingConditionSpec): Result<TResult, string>;
  visitRatingIsLess(spec: RatingConditionSpec): Result<TResult, string>;
  visitRatingIsLessEqual(spec: RatingConditionSpec): Result<TResult, string>;
  visitRatingIsEmpty(spec: RatingConditionSpec): Result<TResult, string>;
  visitRatingIsNotEmpty(spec: RatingConditionSpec): Result<TResult, string>;

  visitCheckboxIs(spec: CheckboxConditionSpec): Result<TResult, string>;

  visitDateIs(spec: DateConditionSpec): Result<TResult, string>;
  visitDateIsNot(spec: DateConditionSpec): Result<TResult, string>;
  visitDateIsWithIn(spec: DateConditionSpec): Result<TResult, string>;
  visitDateIsBefore(spec: DateConditionSpec): Result<TResult, string>;
  visitDateIsAfter(spec: DateConditionSpec): Result<TResult, string>;
  visitDateIsOnOrBefore(spec: DateConditionSpec): Result<TResult, string>;
  visitDateIsOnOrAfter(spec: DateConditionSpec): Result<TResult, string>;
  visitDateIsEmpty(spec: DateConditionSpec): Result<TResult, string>;
  visitDateIsNotEmpty(spec: DateConditionSpec): Result<TResult, string>;

  visitSingleSelectIs(spec: SingleSelectConditionSpec): Result<TResult, string>;
  visitSingleSelectIsNot(spec: SingleSelectConditionSpec): Result<TResult, string>;
  visitSingleSelectIsAnyOf(spec: SingleSelectConditionSpec): Result<TResult, string>;
  visitSingleSelectIsNoneOf(spec: SingleSelectConditionSpec): Result<TResult, string>;
  visitSingleSelectIsEmpty(spec: SingleSelectConditionSpec): Result<TResult, string>;
  visitSingleSelectIsNotEmpty(spec: SingleSelectConditionSpec): Result<TResult, string>;

  visitMultipleSelectHasAnyOf(spec: MultipleSelectConditionSpec): Result<TResult, string>;
  visitMultipleSelectHasAllOf(spec: MultipleSelectConditionSpec): Result<TResult, string>;
  visitMultipleSelectIsExactly(spec: MultipleSelectConditionSpec): Result<TResult, string>;
  visitMultipleSelectIsNotExactly(spec: MultipleSelectConditionSpec): Result<TResult, string>;
  visitMultipleSelectHasNoneOf(spec: MultipleSelectConditionSpec): Result<TResult, string>;
  visitMultipleSelectIsEmpty(spec: MultipleSelectConditionSpec): Result<TResult, string>;
  visitMultipleSelectIsNotEmpty(spec: MultipleSelectConditionSpec): Result<TResult, string>;

  visitAttachmentIsEmpty(spec: AttachmentConditionSpec): Result<TResult, string>;
  visitAttachmentIsNotEmpty(spec: AttachmentConditionSpec): Result<TResult, string>;

  visitUserIs(spec: UserConditionSpec): Result<TResult, string>;
  visitUserIsNot(spec: UserConditionSpec): Result<TResult, string>;
  visitUserIsAnyOf(spec: UserConditionSpec): Result<TResult, string>;
  visitUserIsNoneOf(spec: UserConditionSpec): Result<TResult, string>;
  visitUserHasAnyOf(spec: UserConditionSpec): Result<TResult, string>;
  visitUserHasAllOf(spec: UserConditionSpec): Result<TResult, string>;
  visitUserIsExactly(spec: UserConditionSpec): Result<TResult, string>;
  visitUserIsNotExactly(spec: UserConditionSpec): Result<TResult, string>;
  visitUserHasNoneOf(spec: UserConditionSpec): Result<TResult, string>;
  visitUserIsEmpty(spec: UserConditionSpec): Result<TResult, string>;
  visitUserIsNotEmpty(spec: UserConditionSpec): Result<TResult, string>;

  visitLinkIs(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkIsNot(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkIsAnyOf(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkIsNoneOf(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkHasAnyOf(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkHasAllOf(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkIsExactly(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkIsNotExactly(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkHasNoneOf(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkContains(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkDoesNotContain(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkIsEmpty(spec: LinkConditionSpec): Result<TResult, string>;
  visitLinkIsNotEmpty(spec: LinkConditionSpec): Result<TResult, string>;

  visitFormulaIs(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsNot(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaContains(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaDoesNotContain(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsEmpty(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsNotEmpty(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsGreater(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsGreaterEqual(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsLess(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsLessEqual(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsAnyOf(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsNoneOf(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaHasAnyOf(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaHasAllOf(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsNotExactly(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaHasNoneOf(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsExactly(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsWithIn(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsBefore(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsAfter(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsOnOrBefore(spec: FormulaConditionSpec): Result<TResult, string>;
  visitFormulaIsOnOrAfter(spec: FormulaConditionSpec): Result<TResult, string>;

  visitRollupIs(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsNot(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupContains(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupDoesNotContain(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsEmpty(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsNotEmpty(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsGreater(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsGreaterEqual(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsLess(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsLessEqual(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsAnyOf(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsNoneOf(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupHasAnyOf(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupHasAllOf(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsNotExactly(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupHasNoneOf(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsExactly(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsWithIn(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsBefore(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsAfter(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsOnOrBefore(spec: RollupConditionSpec): Result<TResult, string>;
  visitRollupIsOnOrAfter(spec: RollupConditionSpec): Result<TResult, string>;
}
