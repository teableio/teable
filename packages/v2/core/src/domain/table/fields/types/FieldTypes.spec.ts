import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { NoopFieldVisitor } from '../visitors/NoopFieldVisitor';
import { AttachmentField } from './AttachmentField';
import { ButtonField } from './ButtonField';
import { ButtonLabel } from './ButtonLabel';
import { ButtonMaxCount } from './ButtonMaxCount';
import { ButtonResetCount } from './ButtonResetCount';
import { ButtonWorkflow } from './ButtonWorkflow';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { CheckboxDefaultValue } from './CheckboxDefaultValue';
import { CheckboxField } from './CheckboxField';
import { DateDefaultValue } from './DateDefaultValue';
import { DateField } from './DateField';
import { DateTimeFormatting } from './DateTimeFormatting';
import { FieldColor } from './FieldColor';
import { FormulaExpression } from './FormulaExpression';
import { FormulaField } from './FormulaField';
import { LongTextField } from './LongTextField';
import { MultipleSelectField } from './MultipleSelectField';
import { NumberDefaultValue } from './NumberDefaultValue';
import { NumberField } from './NumberField';
import { NumberFormatting } from './NumberFormatting';
import { NumberShowAs } from './NumberShowAs';
import { RatingColor } from './RatingColor';
import { RatingField } from './RatingField';
import { RatingIcon } from './RatingIcon';
import { RatingMax } from './RatingMax';
import { SelectAutoNewOptions } from './SelectAutoNewOptions';
import { SelectDefaultValue } from './SelectDefaultValue';
import { SelectOption } from './SelectOption';
import { SingleLineTextField } from './SingleLineTextField';
import { SingleLineTextShowAs } from './SingleLineTextShowAs';
import { SingleSelectField } from './SingleSelectField';
import { TextDefaultValue } from './TextDefaultValue';
import { UserDefaultValue } from './UserDefaultValue';
import { UserField } from './UserField';
import { UserMultiplicity } from './UserMultiplicity';
import { UserNotification } from './UserNotification';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

class RecordingFieldVisitor implements IFieldVisitor<string> {
  visitSingleLineTextField(): ReturnType<IFieldVisitor<string>['visitSingleLineTextField']> {
    return ok('singleLineText');
  }
  visitLongTextField(): ReturnType<IFieldVisitor<string>['visitLongTextField']> {
    return ok('longText');
  }
  visitNumberField(): ReturnType<IFieldVisitor<string>['visitNumberField']> {
    return ok('number');
  }
  visitRatingField(): ReturnType<IFieldVisitor<string>['visitRatingField']> {
    return ok('rating');
  }
  visitFormulaField(): ReturnType<IFieldVisitor<string>['visitFormulaField']> {
    return ok('formula');
  }
  visitSingleSelectField(): ReturnType<IFieldVisitor<string>['visitSingleSelectField']> {
    return ok('singleSelect');
  }
  visitMultipleSelectField(): ReturnType<IFieldVisitor<string>['visitMultipleSelectField']> {
    return ok('multipleSelect');
  }
  visitCheckboxField(): ReturnType<IFieldVisitor<string>['visitCheckboxField']> {
    return ok('checkbox');
  }
  visitAttachmentField(): ReturnType<IFieldVisitor<string>['visitAttachmentField']> {
    return ok('attachment');
  }
  visitDateField(): ReturnType<IFieldVisitor<string>['visitDateField']> {
    return ok('date');
  }
  visitUserField(): ReturnType<IFieldVisitor<string>['visitUserField']> {
    return ok('user');
  }
  visitButtonField(): ReturnType<IFieldVisitor<string>['visitButtonField']> {
    return ok('button');
  }
}

describe('Field types', () => {
  it('exposes options and accepts visitors', () => {
    const idResult = createFieldId('a');
    const nameResult = FieldName.create('Name');
    const optionResult = SelectOption.create({ name: 'Todo', color: 'blue' });
    const showAsResult = SingleLineTextShowAs.create({ type: 'email' });
    const textDefaultResult = TextDefaultValue.create('hello');
    const formattingResult = NumberFormatting.create({
      type: 'currency',
      precision: 2,
      symbol: '$',
    });
    const numberShowAsResult = NumberShowAs.create({
      type: 'bar',
      color: 'teal',
      showValue: true,
      maxValue: 100,
    });
    const numberDefaultResult = NumberDefaultValue.create(10);
    const ratingMaxResult = RatingMax.create(5);
    const ratingIconResult = RatingIcon.create('star');
    const ratingColorResult = RatingColor.create('yellowBright');
    const selectDefaultResult = SelectDefaultValue.create('Todo');
    const selectAutoResult = SelectAutoNewOptions.create(false);
    const checkboxDefaultResult = CheckboxDefaultValue.create(true);
    const dateFormattingResult = DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: 'HH:mm',
      timeZone: 'utc',
    });
    const dateDefaultResult = DateDefaultValue.create('now');
    const userMultiplicityResult = UserMultiplicity.create(true);
    const userNotificationResult = UserNotification.create(false);
    const userDefaultResult = UserDefaultValue.create(['me']);
    const buttonLabelResult = ButtonLabel.create('Run');
    const buttonColorResult = FieldColor.create('teal');
    const buttonMaxResult = ButtonMaxCount.create(3);
    const buttonResetResult = ButtonResetCount.create(true);
    const buttonWorkflowResult = ButtonWorkflow.create({
      id: `wfl${'a'.repeat(16)}`,
      name: 'Deploy',
      isActive: true,
    });
    const formulaExpressionResult = FormulaExpression.create('{fld123} + 1');

    expect(
      [
        idResult,
        nameResult,
        optionResult,
        showAsResult,
        textDefaultResult,
        formattingResult,
        numberShowAsResult,
        numberDefaultResult,
        ratingMaxResult,
        ratingIconResult,
        ratingColorResult,
        selectDefaultResult,
        selectAutoResult,
        checkboxDefaultResult,
        dateFormattingResult,
        dateDefaultResult,
        userMultiplicityResult,
        userNotificationResult,
        userDefaultResult,
        buttonLabelResult,
        buttonColorResult,
        buttonMaxResult,
        buttonResetResult,
        buttonWorkflowResult,
        formulaExpressionResult,
      ].every((r) => r.isOk())
    ).toBe(true);
    if (
      idResult.isErr() ||
      nameResult.isErr() ||
      optionResult.isErr() ||
      showAsResult.isErr() ||
      textDefaultResult.isErr() ||
      formattingResult.isErr() ||
      numberShowAsResult.isErr() ||
      numberDefaultResult.isErr() ||
      ratingMaxResult.isErr() ||
      ratingIconResult.isErr() ||
      ratingColorResult.isErr() ||
      selectDefaultResult.isErr() ||
      selectAutoResult.isErr() ||
      checkboxDefaultResult.isErr() ||
      dateFormattingResult.isErr() ||
      dateDefaultResult.isErr() ||
      userMultiplicityResult.isErr() ||
      userNotificationResult.isErr() ||
      userDefaultResult.isErr() ||
      buttonLabelResult.isErr() ||
      buttonColorResult.isErr() ||
      buttonMaxResult.isErr() ||
      buttonResetResult.isErr() ||
      buttonWorkflowResult.isErr() ||
      formulaExpressionResult.isErr()
    )
      return;

    const id = idResult.value;
    const name = nameResult.value;
    const option = optionResult.value;

    const visitor = new RecordingFieldVisitor();

    const singleText = SingleLineTextField.create({
      id,
      name,
      showAs: showAsResult.value,
      defaultValue: textDefaultResult.value,
    });
    expect(singleText.isOk()).toBe(true);
    if (singleText.isErr()) return;
    expect(singleText.value.showAs()).toBe(showAsResult.value);
    expect(singleText.value.defaultValue()).toBe(textDefaultResult.value);
    const singleAccept = singleText.value.accept(visitor);
    expect(singleAccept.isOk()).toBe(true);
    if (singleAccept.isErr()) return;
    expect(singleAccept.value).toBe('singleLineText');

    const longText = LongTextField.create({ id, name, defaultValue: textDefaultResult.value });
    expect(longText.isOk()).toBe(true);
    if (longText.isErr()) return;
    expect(longText.value.defaultValue()).toBe(textDefaultResult.value);
    const longAccept = longText.value.accept(visitor);
    expect(longAccept.isOk()).toBe(true);
    if (longAccept.isErr()) return;
    expect(longAccept.value).toBe('longText');

    const number = NumberField.create({
      id,
      name,
      formatting: formattingResult.value,
      showAs: numberShowAsResult.value,
      defaultValue: numberDefaultResult.value,
    });
    expect(number.isOk()).toBe(true);
    if (number.isErr()) return;
    expect(number.value.formatting()).toBe(formattingResult.value);
    expect(number.value.showAs()).toBe(numberShowAsResult.value);
    expect(number.value.defaultValue()).toBe(numberDefaultResult.value);
    const numberAccept = number.value.accept(visitor);
    expect(numberAccept.isOk()).toBe(true);
    if (numberAccept.isErr()) return;
    expect(numberAccept.value).toBe('number');

    const rating = RatingField.create({
      id,
      name,
      max: ratingMaxResult.value,
      icon: ratingIconResult.value,
      color: ratingColorResult.value,
    });
    expect(rating.isOk()).toBe(true);
    if (rating.isErr()) return;
    expect(rating.value.ratingMax()).toBe(ratingMaxResult.value);
    expect(rating.value.ratingIcon()).toBe(ratingIconResult.value);
    expect(rating.value.ratingColor()).toBe(ratingColorResult.value);
    const ratingAccept = rating.value.accept(visitor);
    expect(ratingAccept.isOk()).toBe(true);
    if (ratingAccept.isErr()) return;
    expect(ratingAccept.value).toBe('rating');

    const formula = FormulaField.create({
      id,
      name,
      expression: formulaExpressionResult.value,
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    });
    expect(formula.isOk()).toBe(true);
    if (formula.isErr()) return;
    const formulaAccept = formula.value.accept(visitor);
    expect(formulaAccept.isOk()).toBe(true);
    if (formulaAccept.isErr()) return;
    expect(formulaAccept.value).toBe('formula');

    const singleSelect = SingleSelectField.create({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult.value,
      preventAutoNewOptions: selectAutoResult.value,
    });
    expect(singleSelect.isOk()).toBe(true);
    if (singleSelect.isErr()) return;
    expect(singleSelect.value.selectOptions().length).toBe(1);
    expect(singleSelect.value.defaultValue()).toBe(selectDefaultResult.value);
    expect(singleSelect.value.preventAutoNewOptions()).toBe(selectAutoResult.value);
    const singleSelectAccept = singleSelect.value.accept(visitor);
    expect(singleSelectAccept.isOk()).toBe(true);
    if (singleSelectAccept.isErr()) return;
    expect(singleSelectAccept.value).toBe('singleSelect');

    const multipleSelect = MultipleSelectField.create({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult.value,
      preventAutoNewOptions: selectAutoResult.value,
    });
    expect(multipleSelect.isOk()).toBe(true);
    if (multipleSelect.isErr()) return;
    expect(multipleSelect.value.selectOptions().length).toBe(1);
    expect(multipleSelect.value.defaultValue()).toBe(selectDefaultResult.value);
    expect(multipleSelect.value.preventAutoNewOptions()).toBe(selectAutoResult.value);
    const multipleSelectAccept = multipleSelect.value.accept(visitor);
    expect(multipleSelectAccept.isOk()).toBe(true);
    if (multipleSelectAccept.isErr()) return;
    expect(multipleSelectAccept.value).toBe('multipleSelect');

    const checkbox = CheckboxField.create({ id, name, defaultValue: checkboxDefaultResult.value });
    expect(checkbox.isOk()).toBe(true);
    if (checkbox.isErr()) return;
    expect(checkbox.value.defaultValue()).toBe(checkboxDefaultResult.value);
    const checkboxAccept = checkbox.value.accept(visitor);
    expect(checkboxAccept.isOk()).toBe(true);
    if (checkboxAccept.isErr()) return;
    expect(checkboxAccept.value).toBe('checkbox');

    const attachment = AttachmentField.create({ id, name });
    expect(attachment.isOk()).toBe(true);
    if (attachment.isErr()) return;
    const attachmentAccept = attachment.value.accept(visitor);
    expect(attachmentAccept.isOk()).toBe(true);
    if (attachmentAccept.isErr()) return;
    expect(attachmentAccept.value).toBe('attachment');

    const dateField = DateField.create({
      id,
      name,
      formatting: dateFormattingResult.value,
      defaultValue: dateDefaultResult.value,
    });
    expect(dateField.isOk()).toBe(true);
    if (dateField.isErr()) return;
    expect(dateField.value.formatting()).toBe(dateFormattingResult.value);
    expect(dateField.value.defaultValue()).toBe(dateDefaultResult.value);
    const dateAccept = dateField.value.accept(visitor);
    expect(dateAccept.isOk()).toBe(true);
    if (dateAccept.isErr()) return;
    expect(dateAccept.value).toBe('date');

    const userField = UserField.create({
      id,
      name,
      isMultiple: userMultiplicityResult.value,
      shouldNotify: userNotificationResult.value,
      defaultValue: userDefaultResult.value,
    });
    expect(userField.isOk()).toBe(true);
    if (userField.isErr()) return;
    expect(userField.value.multiplicity()).toBe(userMultiplicityResult.value);
    expect(userField.value.notification()).toBe(userNotificationResult.value);
    expect(userField.value.defaultValue()).toBe(userDefaultResult.value);
    const userAccept = userField.value.accept(visitor);
    expect(userAccept.isOk()).toBe(true);
    if (userAccept.isErr()) return;
    expect(userAccept.value).toBe('user');

    const buttonField = ButtonField.create({
      id,
      name,
      label: buttonLabelResult.value,
      color: buttonColorResult.value,
      maxCount: buttonMaxResult.value,
      resetCount: buttonResetResult.value,
      workflow: buttonWorkflowResult.value,
    });
    expect(buttonField.isOk()).toBe(true);
    if (buttonField.isErr()) return;
    expect(buttonField.value.label()).toBe(buttonLabelResult.value);
    expect(buttonField.value.color()).toBe(buttonColorResult.value);
    expect(buttonField.value.maxCount()).toBe(buttonMaxResult.value);
    expect(buttonField.value.resetCount()).toBe(buttonResetResult.value);
    expect(buttonField.value.workflow()).toBe(buttonWorkflowResult.value);
    const buttonAccept = buttonField.value.accept(visitor);
    expect(buttonAccept.isOk()).toBe(true);
    if (buttonAccept.isErr()) return;
    expect(buttonAccept.value).toBe('button');

    const noopVisitor = new NoopFieldVisitor();
    expect(buttonField.value.accept(noopVisitor).isOk()).toBe(true);
  });
});
