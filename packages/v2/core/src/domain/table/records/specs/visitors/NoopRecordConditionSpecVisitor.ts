import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { ISpecification } from '../../../../shared/specification/ISpecification';
import type { AttachmentConditionSpec } from '../AttachmentConditionSpec';
import type { ButtonConditionSpec } from '../ButtonConditionSpec';
import type { CheckboxConditionSpec } from '../CheckboxConditionSpec';
import type { DateConditionSpec } from '../DateConditionSpec';
import type { FormulaConditionSpec } from '../FormulaConditionSpec';
import type { ITableRecordConditionSpecVisitor } from '../ITableRecordConditionSpecVisitor';
import type { LinkConditionSpec } from '../LinkConditionSpec';
import type { LongTextConditionSpec } from '../LongTextConditionSpec';
import type { MultipleSelectConditionSpec } from '../MultipleSelectConditionSpec';
import type { NumberConditionSpec } from '../NumberConditionSpec';
import type { RatingConditionSpec } from '../RatingConditionSpec';
import type { RollupConditionSpec } from '../RollupConditionSpec';
import type { SingleLineTextConditionSpec } from '../SingleLineTextConditionSpec';
import type { SingleSelectConditionSpec } from '../SingleSelectConditionSpec';
import type { UserConditionSpec } from '../UserConditionSpec';

export class NoopRecordConditionSpecVisitor implements ITableRecordConditionSpecVisitor<void> {
  private noop(): Result<void, string> {
    return ok(undefined);
  }

  visit(_: ISpecification): Result<void, string> {
    return this.noop();
  }

  visitSingleLineTextIs(_: SingleLineTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleLineTextIsNot(_: SingleLineTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleLineTextContains(_: SingleLineTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleLineTextDoesNotContain(_: SingleLineTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleLineTextIsEmpty(_: SingleLineTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleLineTextIsNotEmpty(_: SingleLineTextConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitLongTextIs(_: LongTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLongTextIsNot(_: LongTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLongTextContains(_: LongTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLongTextDoesNotContain(_: LongTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLongTextIsEmpty(_: LongTextConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLongTextIsNotEmpty(_: LongTextConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitButtonIs(_: ButtonConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitButtonIsNot(_: ButtonConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitButtonContains(_: ButtonConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitButtonDoesNotContain(_: ButtonConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitButtonIsEmpty(_: ButtonConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitButtonIsNotEmpty(_: ButtonConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitNumberIs(_: NumberConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitNumberIsNot(_: NumberConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitNumberIsGreater(_: NumberConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitNumberIsGreaterEqual(_: NumberConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitNumberIsLess(_: NumberConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitNumberIsLessEqual(_: NumberConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitNumberIsEmpty(_: NumberConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitNumberIsNotEmpty(_: NumberConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitRatingIs(_: RatingConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRatingIsNot(_: RatingConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRatingIsGreater(_: RatingConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRatingIsGreaterEqual(_: RatingConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRatingIsLess(_: RatingConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRatingIsLessEqual(_: RatingConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRatingIsEmpty(_: RatingConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRatingIsNotEmpty(_: RatingConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitCheckboxIs(_: CheckboxConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitDateIs(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitDateIsNot(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitDateIsWithIn(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitDateIsBefore(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitDateIsAfter(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitDateIsOnOrBefore(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitDateIsOnOrAfter(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitDateIsEmpty(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitDateIsNotEmpty(_: DateConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitSingleSelectIs(_: SingleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleSelectIsNot(_: SingleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleSelectIsAnyOf(_: SingleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleSelectIsNoneOf(_: SingleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleSelectIsEmpty(_: SingleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitSingleSelectIsNotEmpty(_: SingleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitMultipleSelectHasAnyOf(_: MultipleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitMultipleSelectHasAllOf(_: MultipleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitMultipleSelectIsExactly(_: MultipleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitMultipleSelectIsNotExactly(_: MultipleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitMultipleSelectHasNoneOf(_: MultipleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitMultipleSelectIsEmpty(_: MultipleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitMultipleSelectIsNotEmpty(_: MultipleSelectConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitAttachmentIsEmpty(_: AttachmentConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitAttachmentIsNotEmpty(_: AttachmentConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitUserIs(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserIsNot(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserIsAnyOf(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserIsNoneOf(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserHasAnyOf(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserHasAllOf(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserIsExactly(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserIsNotExactly(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserHasNoneOf(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserIsEmpty(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitUserIsNotEmpty(_: UserConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitLinkIs(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkIsNot(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkIsAnyOf(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkIsNoneOf(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkHasAnyOf(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkHasAllOf(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkIsExactly(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkIsNotExactly(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkHasNoneOf(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkContains(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkDoesNotContain(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkIsEmpty(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitLinkIsNotEmpty(_: LinkConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitFormulaIs(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsNot(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaContains(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaDoesNotContain(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsEmpty(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsNotEmpty(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsGreater(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsGreaterEqual(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsLess(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsLessEqual(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsAnyOf(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsNoneOf(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaHasAnyOf(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaHasAllOf(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsNotExactly(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaHasNoneOf(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsExactly(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsWithIn(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsBefore(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsAfter(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsOnOrBefore(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitFormulaIsOnOrAfter(_: FormulaConditionSpec): Result<void, string> {
    return this.noop();
  }

  visitRollupIs(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsNot(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupContains(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupDoesNotContain(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsEmpty(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsNotEmpty(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsGreater(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsGreaterEqual(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsLess(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsLessEqual(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsAnyOf(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsNoneOf(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupHasAnyOf(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupHasAllOf(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsNotExactly(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupHasNoneOf(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsExactly(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsWithIn(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsBefore(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsAfter(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsOnOrBefore(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
  visitRollupIsOnOrAfter(_: RollupConditionSpec): Result<void, string> {
    return this.noop();
  }
}
