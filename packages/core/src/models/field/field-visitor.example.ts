import type { AttachmentFieldCore } from './derivate/attachment.field';
import type { AutoNumberFieldCore } from './derivate/auto-number.field';
import type { CheckboxFieldCore } from './derivate/checkbox.field';
import type { CreatedByFieldCore } from './derivate/created-by.field';
import type { CreatedTimeFieldCore } from './derivate/created-time.field';
import type { DateFieldCore } from './derivate/date.field';
import type { FormulaFieldCore } from './derivate/formula.field';
import type { LastModifiedByFieldCore } from './derivate/last-modified-by.field';
import type { LastModifiedTimeFieldCore } from './derivate/last-modified-time.field';
import type { LinkFieldCore } from './derivate/link.field';
import type { LongTextFieldCore } from './derivate/long-text.field';
import type { MultipleSelectFieldCore } from './derivate/multiple-select.field';
import type { NumberFieldCore } from './derivate/number.field';
import type { RatingFieldCore } from './derivate/rating.field';
import type { RollupFieldCore } from './derivate/rollup.field';
import type { SingleLineTextFieldCore } from './derivate/single-line-text.field';
import type { SingleSelectFieldCore } from './derivate/single-select.field';
import type { UserFieldCore } from './derivate/user.field';
import type { IFieldVisitor } from './field-visitor.interface';

/**
 * Example visitor implementation that returns the field type name as a string.
 * This demonstrates how to implement the IFieldVisitor interface.
 */
export class FieldTypeNameVisitor implements IFieldVisitor<string> {
  visitNumberField(_field: NumberFieldCore): string {
    return 'Number Field';
  }

  visitSingleLineTextField(_field: SingleLineTextFieldCore): string {
    return 'Single Line Text Field';
  }

  visitLongTextField(_field: LongTextFieldCore): string {
    return 'Long Text Field';
  }

  visitAttachmentField(_field: AttachmentFieldCore): string {
    return 'Attachment Field';
  }

  visitCheckboxField(_field: CheckboxFieldCore): string {
    return 'Checkbox Field';
  }

  visitDateField(_field: DateFieldCore): string {
    return 'Date Field';
  }

  visitRatingField(_field: RatingFieldCore): string {
    return 'Rating Field';
  }

  visitAutoNumberField(_field: AutoNumberFieldCore): string {
    return 'Auto Number Field';
  }

  visitLinkField(_field: LinkFieldCore): string {
    return 'Link Field';
  }

  visitRollupField(_field: RollupFieldCore): string {
    return 'Rollup Field';
  }

  visitSingleSelectField(_field: SingleSelectFieldCore): string {
    return 'Single Select Field';
  }

  visitMultipleSelectField(_field: MultipleSelectFieldCore): string {
    return 'Multiple Select Field';
  }

  visitFormulaField(_field: FormulaFieldCore): string {
    return 'Formula Field';
  }

  visitCreatedTimeField(_field: CreatedTimeFieldCore): string {
    return 'Created Time Field';
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): string {
    return 'Last Modified Time Field';
  }

  visitUserField(_field: UserFieldCore): string {
    return 'User Field';
  }

  visitCreatedByField(_field: CreatedByFieldCore): string {
    return 'Created By Field';
  }

  visitLastModifiedByField(_field: LastModifiedByFieldCore): string {
    return 'Last Modified By Field';
  }
}

/**
 * Example visitor implementation that counts field types.
 * This demonstrates how to use the visitor pattern for aggregation operations.
 */
export class FieldCountVisitor implements IFieldVisitor<number> {
  private count = 0;

  getCount(): number {
    return this.count;
  }

  resetCount(): void {
    this.count = 0;
  }

  visitNumberField(_field: NumberFieldCore): number {
    return ++this.count;
  }

  visitSingleLineTextField(_field: SingleLineTextFieldCore): number {
    return ++this.count;
  }

  visitLongTextField(_field: LongTextFieldCore): number {
    return ++this.count;
  }

  visitAttachmentField(_field: AttachmentFieldCore): number {
    return ++this.count;
  }

  visitCheckboxField(_field: CheckboxFieldCore): number {
    return ++this.count;
  }

  visitDateField(_field: DateFieldCore): number {
    return ++this.count;
  }

  visitRatingField(_field: RatingFieldCore): number {
    return ++this.count;
  }

  visitAutoNumberField(_field: AutoNumberFieldCore): number {
    return ++this.count;
  }

  visitLinkField(_field: LinkFieldCore): number {
    return ++this.count;
  }

  visitRollupField(_field: RollupFieldCore): number {
    return ++this.count;
  }

  visitSingleSelectField(_field: SingleSelectFieldCore): number {
    return ++this.count;
  }

  visitMultipleSelectField(_field: MultipleSelectFieldCore): number {
    return ++this.count;
  }

  visitFormulaField(_field: FormulaFieldCore): number {
    return ++this.count;
  }

  visitCreatedTimeField(_field: CreatedTimeFieldCore): number {
    return ++this.count;
  }

  visitLastModifiedTimeField(_field: LastModifiedTimeFieldCore): number {
    return ++this.count;
  }

  visitUserField(_field: UserFieldCore): number {
    return ++this.count;
  }

  visitCreatedByField(_field: CreatedByFieldCore): number {
    return ++this.count;
  }

  visitLastModifiedByField(_field: LastModifiedByFieldCore): number {
    return ++this.count;
  }
}
