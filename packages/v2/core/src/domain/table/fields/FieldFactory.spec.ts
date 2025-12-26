import { describe, expect, it } from 'vitest';

import {
  createAttachmentField,
  createButtonField,
  createCheckboxField,
  createDateField,
  createFormulaField,
  createLinkField,
  createLongTextField,
  createMultipleSelectField,
  createNumberField,
  createRatingField,
  createSingleLineTextField,
  createSingleSelectField,
  createTextField,
  createUserField,
} from './FieldFactory';
import { FieldId } from './FieldId';
import { FieldName } from './FieldName';
import { ButtonLabel } from './types/ButtonLabel';
import { ButtonMaxCount } from './types/ButtonMaxCount';
import { ButtonResetCount } from './types/ButtonResetCount';
import { ButtonWorkflow } from './types/ButtonWorkflow';
import { CellValueMultiplicity } from './types/CellValueMultiplicity';
import { CellValueType } from './types/CellValueType';
import { CheckboxDefaultValue } from './types/CheckboxDefaultValue';
import { DateDefaultValue } from './types/DateDefaultValue';
import { DateTimeFormatting } from './types/DateTimeFormatting';
import { FieldColor } from './types/FieldColor';
import { FormulaExpression } from './types/FormulaExpression';
import { LinkFieldConfig } from './types/LinkFieldConfig';
import { LinkRelationship } from './types/LinkRelationship';
import { NumberDefaultValue } from './types/NumberDefaultValue';
import { NumberFormatting } from './types/NumberFormatting';
import { NumberShowAs } from './types/NumberShowAs';
import { RatingColor } from './types/RatingColor';
import { RatingIcon } from './types/RatingIcon';
import { RatingMax } from './types/RatingMax';
import { SelectAutoNewOptions } from './types/SelectAutoNewOptions';
import { SelectDefaultValue } from './types/SelectDefaultValue';
import { SelectOption } from './types/SelectOption';
import { SingleLineTextShowAs } from './types/SingleLineTextShowAs';
import { TextDefaultValue } from './types/TextDefaultValue';
import { UserDefaultValue } from './types/UserDefaultValue';
import { UserMultiplicity } from './types/UserMultiplicity';
import { UserNotification } from './types/UserNotification';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

describe('FieldFactory', () => {
  it('creates all supported field types', () => {
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
    const linkConfigResult = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: `tbl${'b'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
    });

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
        linkConfigResult,
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
      formulaExpressionResult.isErr() ||
      linkConfigResult.isErr()
    )
      return;

    const id = idResult.value;
    const name = nameResult.value;
    const option = optionResult.value;

    const singleText = createSingleLineTextField({
      id,
      name,
      showAs: showAsResult.value,
      defaultValue: textDefaultResult.value,
    });
    expect(singleText.isOk()).toBe(true);
    if (singleText.isErr()) return;
    expect(singleText.value.type().toString()).toBe('singleLineText');

    const textAlias = createTextField({ id, name });
    expect(textAlias.isOk()).toBe(true);

    const longText = createLongTextField({ id, name, defaultValue: textDefaultResult.value });
    expect(longText.isOk()).toBe(true);
    if (longText.isErr()) return;
    expect(longText.value.type().toString()).toBe('longText');

    const number = createNumberField({
      id,
      name,
      formatting: formattingResult.value,
      showAs: numberShowAsResult.value,
      defaultValue: numberDefaultResult.value,
    });
    expect(number.isOk()).toBe(true);
    if (number.isErr()) return;
    expect(number.value.type().toString()).toBe('number');

    const rating = createRatingField({
      id,
      name,
      max: ratingMaxResult.value,
      icon: ratingIconResult.value,
      color: ratingColorResult.value,
    });
    expect(rating.isOk()).toBe(true);
    if (rating.isErr()) return;
    expect(rating.value.type().toString()).toBe('rating');

    const formula = createFormulaField({
      id,
      name,
      expression: formulaExpressionResult.value,
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    });
    expect(formula.isOk()).toBe(true);

    const singleSelect = createSingleSelectField({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult.value,
      preventAutoNewOptions: selectAutoResult.value,
    });
    expect(singleSelect.isOk()).toBe(true);
    if (singleSelect.isErr()) return;
    expect(singleSelect.value.type().toString()).toBe('singleSelect');

    const multipleSelect = createMultipleSelectField({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult.value,
      preventAutoNewOptions: selectAutoResult.value,
    });
    expect(multipleSelect.isOk()).toBe(true);
    if (multipleSelect.isErr()) return;
    expect(multipleSelect.value.type().toString()).toBe('multipleSelect');

    const checkbox = createCheckboxField({
      id,
      name,
      defaultValue: checkboxDefaultResult.value,
    });
    expect(checkbox.isOk()).toBe(true);
    if (checkbox.isErr()) return;
    expect(checkbox.value.type().toString()).toBe('checkbox');

    const attachment = createAttachmentField({ id, name });
    expect(attachment.isOk()).toBe(true);
    if (attachment.isErr()) return;
    expect(attachment.value.type().toString()).toBe('attachment');

    const dateField = createDateField({
      id,
      name,
      formatting: dateFormattingResult.value,
      defaultValue: dateDefaultResult.value,
    });
    expect(dateField.isOk()).toBe(true);
    if (dateField.isErr()) return;
    expect(dateField.value.type().toString()).toBe('date');

    const userField = createUserField({
      id,
      name,
      isMultiple: userMultiplicityResult.value,
      shouldNotify: userNotificationResult.value,
      defaultValue: userDefaultResult.value,
    });
    expect(userField.isOk()).toBe(true);
    if (userField.isErr()) return;
    expect(userField.value.type().toString()).toBe('user');

    const buttonField = createButtonField({
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
    expect(buttonField.value.type().toString()).toBe('button');

    const linkField = createLinkField({
      id,
      name,
      config: linkConfigResult.value,
    });
    expect(linkField.isOk()).toBe(true);
    if (linkField.isErr()) return;
    expect(linkField.value.type().toString()).toBe('link');
  });
});
