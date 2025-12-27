import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableId } from '../../TableId';
import { ViewId } from '../../views/ViewId';
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
import { LinkField } from './LinkField';
import { LinkFieldConfig } from './LinkFieldConfig';
import { LinkRelationship } from './LinkRelationship';
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
import { RollupExpression } from './RollupExpression';
import { RollupField } from './RollupField';
import { RollupFieldConfig } from './RollupFieldConfig';
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
  visitRollupField(): ReturnType<IFieldVisitor<string>['visitRollupField']> {
    return ok('rollup');
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
  visitLinkField(): ReturnType<IFieldVisitor<string>['visitLinkField']> {
    return ok('link');
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
    const rollupExpressionResult = RollupExpression.create('countall({values})');
    const foreignTableIdResult = TableId.create(`tbl${'b'.repeat(16)}`);
    const lookupFieldIdResult = createFieldId('b');
    const symmetricFieldIdResult = createFieldId('c');
    const viewIdResult = ViewId.create(`viw${'c'.repeat(16)}`);
    const linkConfigResult = LinkFieldConfig.create({
      relationship: LinkRelationship.manyOne().toString(),
      foreignTableId: `tbl${'b'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      fkHostTableName: 'link_table',
      selfKeyName: '__id',
      foreignKeyName: '__fk_field',
      symmetricFieldId: `fld${'c'.repeat(16)}`,
      filterByViewId: `viw${'c'.repeat(16)}`,
      visibleFieldIds: [`fld${'b'.repeat(16)}`],
    });
    const rollupConfigResult = RollupFieldConfig.create({
      linkFieldId: `fld${'d'.repeat(16)}`,
      foreignTableId: `tbl${'b'.repeat(16)}`,
      lookupFieldId: `fld${'e'.repeat(16)}`,
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
      foreignTableIdResult,
      lookupFieldIdResult,
      symmetricFieldIdResult,
      viewIdResult,
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
    foreignTableIdResult._unsafeUnwrap();
    lookupFieldIdResult._unsafeUnwrap();
    symmetricFieldIdResult._unsafeUnwrap();
    viewIdResult._unsafeUnwrap();
    linkConfigResult._unsafeUnwrap();
    rollupConfigResult._unsafeUnwrap();

    const id = idResult._unsafeUnwrap();
    const name = nameResult._unsafeUnwrap();
    const option = optionResult._unsafeUnwrap();

    const visitor = new RecordingFieldVisitor();

    const singleText = SingleLineTextField.create({
      id,
      name,
      showAs: showAsResult._unsafeUnwrap(),
      defaultValue: textDefaultResult._unsafeUnwrap(),
    });
    singleText._unsafeUnwrap();

    expect(singleText.value.showAs()).toBe(showAsResult._unsafeUnwrap());
    expect(singleText.value.defaultValue()).toBe(textDefaultResult._unsafeUnwrap());
    const singleAccept = singleText.value.accept(visitor);
    singleAccept._unsafeUnwrap();

    expect(singleAccept.value).toBe('singleLineText');

    const longText = LongTextField.create({
      id,
      name,
      defaultValue: textDefaultResult._unsafeUnwrap(),
    });
    longText._unsafeUnwrap();

    expect(longText.value.defaultValue()).toBe(textDefaultResult._unsafeUnwrap());
    const longAccept = longText.value.accept(visitor);
    longAccept._unsafeUnwrap();

    expect(longAccept.value).toBe('longText');

    const number = NumberField.create({
      id,
      name,
      formatting: formattingResult._unsafeUnwrap(),
      showAs: numberShowAsResult._unsafeUnwrap(),
      defaultValue: numberDefaultResult._unsafeUnwrap(),
    });
    number._unsafeUnwrap();

    expect(number.value.formatting()).toBe(formattingResult._unsafeUnwrap());
    expect(number.value.showAs()).toBe(numberShowAsResult._unsafeUnwrap());
    expect(number.value.defaultValue()).toBe(numberDefaultResult._unsafeUnwrap());
    const numberAccept = number.value.accept(visitor);
    numberAccept._unsafeUnwrap();

    expect(numberAccept.value).toBe('number');

    const rating = RatingField.create({
      id,
      name,
      max: ratingMaxResult._unsafeUnwrap(),
      icon: ratingIconResult._unsafeUnwrap(),
      color: ratingColorResult._unsafeUnwrap(),
    });
    rating._unsafeUnwrap();

    expect(rating.value.ratingMax()).toBe(ratingMaxResult._unsafeUnwrap());
    expect(rating.value.ratingIcon()).toBe(ratingIconResult._unsafeUnwrap());
    expect(rating.value.ratingColor()).toBe(ratingColorResult._unsafeUnwrap());
    const ratingAccept = rating.value.accept(visitor);
    ratingAccept._unsafeUnwrap();

    expect(ratingAccept.value).toBe('rating');

    const formula = FormulaField.create({
      id,
      name,
      expression: formulaExpressionResult._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    });
    formula._unsafeUnwrap();

    const formulaAccept = formula.value.accept(visitor);
    formulaAccept._unsafeUnwrap();

    expect(formulaAccept.value).toBe('formula');

    const valuesFieldIdResult = createFieldId('c');
    const valuesFieldNameResult = FieldName.create('Values');
    valuesFieldIdResult._unsafeUnwrap();
    valuesFieldNameResult._unsafeUnwrap();
    valuesFieldIdResult._unsafeUnwrap();
    valuesFieldNameResult._unsafeUnwrap();
    const valuesField = NumberField.create({
      id: valuesFieldIdResult._unsafeUnwrap(),
      name: valuesFieldNameResult._unsafeUnwrap(),
    });
    valuesField._unsafeUnwrap();

    const rollup = RollupField.create({
      id,
      name,
      config: rollupConfigResult._unsafeUnwrap(),
      expression: rollupExpressionResult._unsafeUnwrap(),
      valuesField: valuesField.value,
    });
    rollup._unsafeUnwrap();

    const rollupAccept = rollup.value.accept(visitor);
    rollupAccept._unsafeUnwrap();

    expect(rollupAccept.value).toBe('rollup');

    const singleSelect = SingleSelectField.create({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult._unsafeUnwrap(),
      preventAutoNewOptions: selectAutoResult._unsafeUnwrap(),
    });
    singleSelect._unsafeUnwrap();

    expect(singleSelect.value.selectOptions().length).toBe(1);
    expect(singleSelect.value.defaultValue()).toBe(selectDefaultResult._unsafeUnwrap());
    expect(singleSelect.value.preventAutoNewOptions()).toBe(selectAutoResult._unsafeUnwrap());
    const singleSelectAccept = singleSelect.value.accept(visitor);
    singleSelectAccept._unsafeUnwrap();

    expect(singleSelectAccept.value).toBe('singleSelect');

    const multipleSelect = MultipleSelectField.create({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult._unsafeUnwrap(),
      preventAutoNewOptions: selectAutoResult._unsafeUnwrap(),
    });
    multipleSelect._unsafeUnwrap();

    expect(multipleSelect.value.selectOptions().length).toBe(1);
    expect(multipleSelect.value.defaultValue()).toBe(selectDefaultResult._unsafeUnwrap());
    expect(multipleSelect.value.preventAutoNewOptions()).toBe(selectAutoResult._unsafeUnwrap());
    const multipleSelectAccept = multipleSelect.value.accept(visitor);
    multipleSelectAccept._unsafeUnwrap();

    expect(multipleSelectAccept.value).toBe('multipleSelect');

    const checkbox = CheckboxField.create({
      id,
      name,
      defaultValue: checkboxDefaultResult._unsafeUnwrap(),
    });
    checkbox._unsafeUnwrap();

    expect(checkbox.value.defaultValue()).toBe(checkboxDefaultResult._unsafeUnwrap());
    const checkboxAccept = checkbox.value.accept(visitor);
    checkboxAccept._unsafeUnwrap();

    expect(checkboxAccept.value).toBe('checkbox');

    const attachment = AttachmentField.create({ id, name });
    attachment._unsafeUnwrap();

    const attachmentAccept = attachment.value.accept(visitor);
    attachmentAccept._unsafeUnwrap();

    expect(attachmentAccept.value).toBe('attachment');

    const dateField = DateField.create({
      id,
      name,
      formatting: dateFormattingResult._unsafeUnwrap(),
      defaultValue: dateDefaultResult._unsafeUnwrap(),
    });
    dateField._unsafeUnwrap();

    expect(dateField.value.formatting()).toBe(dateFormattingResult._unsafeUnwrap());
    expect(dateField.value.defaultValue()).toBe(dateDefaultResult._unsafeUnwrap());
    const dateAccept = dateField.value.accept(visitor);
    dateAccept._unsafeUnwrap();

    expect(dateAccept.value).toBe('date');

    const userField = UserField.create({
      id,
      name,
      isMultiple: userMultiplicityResult._unsafeUnwrap(),
      shouldNotify: userNotificationResult._unsafeUnwrap(),
      defaultValue: userDefaultResult._unsafeUnwrap(),
    });
    userField._unsafeUnwrap();

    expect(userField.value.multiplicity()).toBe(userMultiplicityResult._unsafeUnwrap());
    expect(userField.value.notification()).toBe(userNotificationResult._unsafeUnwrap());
    expect(userField.value.defaultValue()).toBe(userDefaultResult._unsafeUnwrap());
    const userAccept = userField.value.accept(visitor);
    userAccept._unsafeUnwrap();

    expect(userAccept.value).toBe('user');

    const buttonField = ButtonField.create({
      id,
      name,
      label: buttonLabelResult._unsafeUnwrap(),
      color: buttonColorResult._unsafeUnwrap(),
      maxCount: buttonMaxResult._unsafeUnwrap(),
      resetCount: buttonResetResult._unsafeUnwrap(),
      workflow: buttonWorkflowResult._unsafeUnwrap(),
    });
    buttonField._unsafeUnwrap();

    expect(buttonField.value.label()).toBe(buttonLabelResult._unsafeUnwrap());
    expect(buttonField.value.color()).toBe(buttonColorResult._unsafeUnwrap());
    expect(buttonField.value.maxCount()).toBe(buttonMaxResult._unsafeUnwrap());
    expect(buttonField.value.resetCount()).toBe(buttonResetResult._unsafeUnwrap());
    expect(buttonField.value.workflow()).toBe(buttonWorkflowResult._unsafeUnwrap());
    const buttonAccept = buttonField.value.accept(visitor);
    buttonAccept._unsafeUnwrap();

    expect(buttonAccept.value).toBe('button');

    const linkField = LinkField.create({ id, name, config: linkConfigResult._unsafeUnwrap() });
    linkField._unsafeUnwrap();

    expect(linkField.value.relationship().equals(LinkRelationship.manyOne())).toBe(true);
    expect(linkField.value.isMultipleValue()).toBe(false);
    const orderColumnResult = linkField.value.orderColumnName();
    orderColumnResult._unsafeUnwrap();

    expect(orderColumnResult._unsafeUnwrap()).toBe('__fk_field_order');
    const linkAccept = linkField.value.accept(visitor);
    linkAccept._unsafeUnwrap();

    expect(linkAccept.value).toBe('link');

    const noopVisitor = new NoopFieldVisitor();
    buttonField.value.accept(noopVisitor)._unsafeUnwrap();
  });
});
