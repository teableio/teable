import { describe, expect, it } from 'vitest';

import {
  createAttachmentField,
  createAutoNumberField,
  createButtonField,
  createCheckboxField,
  createCreatedByField,
  createCreatedTimeField,
  createDateField,
  createFormulaField,
  createLastModifiedByField,
  createLastModifiedTimeField,
  createLinkField,
  createLongTextField,
  createMultipleSelectField,
  createNumberField,
  createRatingField,
  createRollupField,
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
import { RollupExpression } from './types/RollupExpression';
import { RollupFieldConfig } from './types/RollupFieldConfig';
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
    const rollupExpressionResult = RollupExpression.create('countall({values})');
    const linkConfigResult = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: `tbl${'b'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_link',
    });
    const rollupConfigResult = RollupFieldConfig.create({
      linkFieldId: `fld${'b'.repeat(16)}`,
      foreignTableId: `tbl${'b'.repeat(16)}`,
      lookupFieldId: `fld${'c'.repeat(16)}`,
    });

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
      rollupExpressionResult,
      linkConfigResult,
      rollupConfigResult,
    ].forEach((r) => r._unsafeUnwrap());
    idResult._unsafeUnwrap();
    nameResult._unsafeUnwrap();
    optionResult._unsafeUnwrap();
    showAsResult._unsafeUnwrap();
    textDefaultResult._unsafeUnwrap();
    formattingResult._unsafeUnwrap();
    numberShowAsResult._unsafeUnwrap();
    numberDefaultResult._unsafeUnwrap();
    ratingMaxResult._unsafeUnwrap();
    ratingIconResult._unsafeUnwrap();
    ratingColorResult._unsafeUnwrap();
    selectDefaultResult._unsafeUnwrap();
    selectAutoResult._unsafeUnwrap();
    checkboxDefaultResult._unsafeUnwrap();
    dateFormattingResult._unsafeUnwrap();
    dateDefaultResult._unsafeUnwrap();
    userMultiplicityResult._unsafeUnwrap();
    userNotificationResult._unsafeUnwrap();
    userDefaultResult._unsafeUnwrap();
    buttonLabelResult._unsafeUnwrap();
    buttonColorResult._unsafeUnwrap();
    buttonMaxResult._unsafeUnwrap();
    buttonResetResult._unsafeUnwrap();
    buttonWorkflowResult._unsafeUnwrap();
    formulaExpressionResult._unsafeUnwrap();
    rollupExpressionResult._unsafeUnwrap();
    linkConfigResult._unsafeUnwrap();
    rollupConfigResult._unsafeUnwrap();

    const id = idResult._unsafeUnwrap();
    const name = nameResult._unsafeUnwrap();
    const option = optionResult._unsafeUnwrap();

    const singleText = createSingleLineTextField({
      id,
      name,
      showAs: showAsResult._unsafeUnwrap(),
      defaultValue: textDefaultResult._unsafeUnwrap(),
    });
    singleText._unsafeUnwrap();

    expect(singleText._unsafeUnwrap().type().toString()).toBe('singleLineText');

    const textAlias = createTextField({ id, name });
    textAlias._unsafeUnwrap();

    const longText = createLongTextField({
      id,
      name,
      defaultValue: textDefaultResult._unsafeUnwrap(),
    });
    longText._unsafeUnwrap();

    expect(longText._unsafeUnwrap().type().toString()).toBe('longText');

    const number = createNumberField({
      id,
      name,
      formatting: formattingResult._unsafeUnwrap(),
      showAs: numberShowAsResult._unsafeUnwrap(),
      defaultValue: numberDefaultResult._unsafeUnwrap(),
    });
    number._unsafeUnwrap();

    expect(number._unsafeUnwrap().type().toString()).toBe('number');

    const rating = createRatingField({
      id,
      name,
      max: ratingMaxResult._unsafeUnwrap(),
      icon: ratingIconResult._unsafeUnwrap(),
      color: ratingColorResult._unsafeUnwrap(),
    });
    rating._unsafeUnwrap();

    expect(rating._unsafeUnwrap().type().toString()).toBe('rating');

    const formula = createFormulaField({
      id,
      name,
      expression: formulaExpressionResult._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    });
    formula._unsafeUnwrap();

    const valuesFieldId = createFieldId('c')._unsafeUnwrap();
    const valuesFieldName = FieldName.create('Values')._unsafeUnwrap();
    const valuesField = createNumberField({
      id: valuesFieldId,
      name: valuesFieldName,
    })._unsafeUnwrap();
    const rollup = createRollupField({
      id,
      name,
      config: rollupConfigResult._unsafeUnwrap(),
      expression: rollupExpressionResult._unsafeUnwrap(),
      valuesField,
    });
    rollup._unsafeUnwrap();

    expect(rollup._unsafeUnwrap().type().toString()).toBe('rollup');

    const singleSelect = createSingleSelectField({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult._unsafeUnwrap(),
      preventAutoNewOptions: selectAutoResult._unsafeUnwrap(),
    });
    singleSelect._unsafeUnwrap();

    expect(singleSelect._unsafeUnwrap().type().toString()).toBe('singleSelect');

    const multipleSelect = createMultipleSelectField({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult._unsafeUnwrap(),
      preventAutoNewOptions: selectAutoResult._unsafeUnwrap(),
    });
    multipleSelect._unsafeUnwrap();

    expect(multipleSelect._unsafeUnwrap().type().toString()).toBe('multipleSelect');

    const checkbox = createCheckboxField({
      id,
      name,
      defaultValue: checkboxDefaultResult._unsafeUnwrap(),
    });
    checkbox._unsafeUnwrap();

    expect(checkbox._unsafeUnwrap().type().toString()).toBe('checkbox');

    const attachment = createAttachmentField({ id, name });
    attachment._unsafeUnwrap();

    expect(attachment._unsafeUnwrap().type().toString()).toBe('attachment');

    const dateField = createDateField({
      id,
      name,
      formatting: dateFormattingResult._unsafeUnwrap(),
      defaultValue: dateDefaultResult._unsafeUnwrap(),
    });
    dateField._unsafeUnwrap();

    expect(dateField._unsafeUnwrap().type().toString()).toBe('date');

    const createdTimeField = createCreatedTimeField({
      id,
      name,
      formatting: dateFormattingResult._unsafeUnwrap(),
    });
    createdTimeField._unsafeUnwrap();

    expect(createdTimeField._unsafeUnwrap().type().toString()).toBe('createdTime');

    const lastModifiedTimeField = createLastModifiedTimeField({
      id,
      name,
      formatting: dateFormattingResult._unsafeUnwrap(),
      trackedFieldIds: [id],
    });
    lastModifiedTimeField._unsafeUnwrap();

    expect(lastModifiedTimeField._unsafeUnwrap().type().toString()).toBe('lastModifiedTime');

    const userField = createUserField({
      id,
      name,
      isMultiple: userMultiplicityResult._unsafeUnwrap(),
      shouldNotify: userNotificationResult._unsafeUnwrap(),
      defaultValue: userDefaultResult._unsafeUnwrap(),
    });
    userField._unsafeUnwrap();

    expect(userField._unsafeUnwrap().type().toString()).toBe('user');

    const createdByField = createCreatedByField({ id, name });
    createdByField._unsafeUnwrap();

    expect(createdByField._unsafeUnwrap().type().toString()).toBe('createdBy');

    const lastModifiedByField = createLastModifiedByField({ id, name, trackedFieldIds: [id] });
    lastModifiedByField._unsafeUnwrap();

    expect(lastModifiedByField._unsafeUnwrap().type().toString()).toBe('lastModifiedBy');

    const autoNumberField = createAutoNumberField({ id, name });
    autoNumberField._unsafeUnwrap();

    expect(autoNumberField._unsafeUnwrap().type().toString()).toBe('autoNumber');

    const buttonField = createButtonField({
      id,
      name,
      label: buttonLabelResult._unsafeUnwrap(),
      color: buttonColorResult._unsafeUnwrap(),
      maxCount: buttonMaxResult._unsafeUnwrap(),
      resetCount: buttonResetResult._unsafeUnwrap(),
      workflow: buttonWorkflowResult._unsafeUnwrap(),
    });
    buttonField._unsafeUnwrap();

    expect(buttonField._unsafeUnwrap().type().toString()).toBe('button');

    const linkField = createLinkField({
      id,
      name,
      config: linkConfigResult._unsafeUnwrap(),
    });
    linkField._unsafeUnwrap();

    expect(linkField._unsafeUnwrap().type().toString()).toBe('link');
  });
});
