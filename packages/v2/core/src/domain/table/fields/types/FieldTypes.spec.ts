import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { TableId } from '../../TableId';
import { ViewId } from '../../views/ViewId';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import type { IFieldVisitor } from '../visitors/IFieldVisitor';
import { NoopFieldVisitor } from '../visitors/NoopFieldVisitor';
import { AttachmentField } from './AttachmentField';
import { AutoNumberField } from './AutoNumberField';
import { ButtonField } from './ButtonField';
import { ButtonLabel } from './ButtonLabel';
import { ButtonMaxCount } from './ButtonMaxCount';
import { ButtonResetCount } from './ButtonResetCount';
import { ButtonWorkflow } from './ButtonWorkflow';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { CheckboxDefaultValue } from './CheckboxDefaultValue';
import { CheckboxField } from './CheckboxField';
import { CreatedByField } from './CreatedByField';
import { CreatedTimeField } from './CreatedTimeField';
import { DateDefaultValue } from './DateDefaultValue';
import { DateField } from './DateField';
import { DateTimeFormatting } from './DateTimeFormatting';
import { FieldColor } from './FieldColor';
import { FormulaExpression } from './FormulaExpression';
import { FormulaField } from './FormulaField';
import { LastModifiedByField } from './LastModifiedByField';
import { LastModifiedTimeField } from './LastModifiedTimeField';
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
  visitCreatedTimeField(): ReturnType<IFieldVisitor<string>['visitCreatedTimeField']> {
    return ok('createdTime');
  }
  visitLastModifiedTimeField(): ReturnType<IFieldVisitor<string>['visitLastModifiedTimeField']> {
    return ok('lastModifiedTime');
  }
  visitUserField(): ReturnType<IFieldVisitor<string>['visitUserField']> {
    return ok('user');
  }
  visitCreatedByField(): ReturnType<IFieldVisitor<string>['visitCreatedByField']> {
    return ok('createdBy');
  }
  visitLastModifiedByField(): ReturnType<IFieldVisitor<string>['visitLastModifiedByField']> {
    return ok('lastModifiedBy');
  }
  visitAutoNumberField(): ReturnType<IFieldVisitor<string>['visitAutoNumberField']> {
    return ok('autoNumber');
  }
  visitButtonField(): ReturnType<IFieldVisitor<string>['visitButtonField']> {
    return ok('button');
  }
  visitLinkField(): ReturnType<IFieldVisitor<string>['visitLinkField']> {
    return ok('link');
  }
  visitLookupField(): ReturnType<IFieldVisitor<string>['visitLookupField']> {
    return ok('lookup');
  }
  visitConditionalRollupField(): ReturnType<IFieldVisitor<string>['visitConditionalRollupField']> {
    return ok('conditionalRollup');
  }
  visitConditionalLookupField(): ReturnType<IFieldVisitor<string>['visitConditionalLookupField']> {
    return ok('conditionalLookup');
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

    expect(singleText._unsafeUnwrap().showAs()).toBe(showAsResult._unsafeUnwrap());
    expect(singleText._unsafeUnwrap().defaultValue()).toBe(textDefaultResult._unsafeUnwrap());
    const singleAccept = singleText._unsafeUnwrap().accept(visitor);
    singleAccept._unsafeUnwrap();

    expect(singleAccept._unsafeUnwrap()).toBe('singleLineText');

    const longText = LongTextField.create({
      id,
      name,
      defaultValue: textDefaultResult._unsafeUnwrap(),
    });
    longText._unsafeUnwrap();

    expect(longText._unsafeUnwrap().defaultValue()).toBe(textDefaultResult._unsafeUnwrap());
    const longAccept = longText._unsafeUnwrap().accept(visitor);
    longAccept._unsafeUnwrap();

    expect(longAccept._unsafeUnwrap()).toBe('longText');

    const number = NumberField.create({
      id,
      name,
      formatting: formattingResult._unsafeUnwrap(),
      showAs: numberShowAsResult._unsafeUnwrap(),
      defaultValue: numberDefaultResult._unsafeUnwrap(),
    });
    number._unsafeUnwrap();

    expect(number._unsafeUnwrap().formatting()).toBe(formattingResult._unsafeUnwrap());
    expect(number._unsafeUnwrap().showAs()).toBe(numberShowAsResult._unsafeUnwrap());
    expect(number._unsafeUnwrap().defaultValue()).toBe(numberDefaultResult._unsafeUnwrap());
    const numberAccept = number._unsafeUnwrap().accept(visitor);
    numberAccept._unsafeUnwrap();

    expect(numberAccept._unsafeUnwrap()).toBe('number');

    const rating = RatingField.create({
      id,
      name,
      max: ratingMaxResult._unsafeUnwrap(),
      icon: ratingIconResult._unsafeUnwrap(),
      color: ratingColorResult._unsafeUnwrap(),
    });
    rating._unsafeUnwrap();

    expect(rating._unsafeUnwrap().ratingMax()).toBe(ratingMaxResult._unsafeUnwrap());
    expect(rating._unsafeUnwrap().ratingIcon()).toBe(ratingIconResult._unsafeUnwrap());
    expect(rating._unsafeUnwrap().ratingColor()).toBe(ratingColorResult._unsafeUnwrap());
    const ratingAccept = rating._unsafeUnwrap().accept(visitor);
    ratingAccept._unsafeUnwrap();

    expect(ratingAccept._unsafeUnwrap()).toBe('rating');

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

    const formulaAccept = formula._unsafeUnwrap().accept(visitor);
    formulaAccept._unsafeUnwrap();

    expect(formulaAccept._unsafeUnwrap()).toBe('formula');

    const valuesFieldIdResult = createFieldId('c');
    const valuesFieldNameResult = FieldName.create('Values');
    valuesFieldIdResult._unsafeUnwrap();
    valuesFieldNameResult._unsafeUnwrap();
    valuesFieldIdResult._unsafeUnwrap();
    valuesFieldNameResult._unsafeUnwrap();
    const valuesField = NumberField.create({
      id: valuesFieldIdResult._unsafeUnwrap(),
      name: valuesFieldNameResult._unsafeUnwrap(),
    })._unsafeUnwrap();

    const rollup = RollupField.create({
      id,
      name,
      config: rollupConfigResult._unsafeUnwrap(),
      expression: rollupExpressionResult._unsafeUnwrap(),
      valuesField,
    });
    rollup._unsafeUnwrap();

    const rollupAccept = rollup._unsafeUnwrap().accept(visitor);
    rollupAccept._unsafeUnwrap();

    expect(rollupAccept._unsafeUnwrap()).toBe('rollup');

    const singleSelect = SingleSelectField.create({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult._unsafeUnwrap(),
      preventAutoNewOptions: selectAutoResult._unsafeUnwrap(),
    });
    singleSelect._unsafeUnwrap();

    expect(singleSelect._unsafeUnwrap().selectOptions().length).toBe(1);
    expect(singleSelect._unsafeUnwrap().defaultValue()).toBe(selectDefaultResult._unsafeUnwrap());
    expect(singleSelect._unsafeUnwrap().preventAutoNewOptions()).toBe(
      selectAutoResult._unsafeUnwrap()
    );
    const singleSelectAccept = singleSelect._unsafeUnwrap().accept(visitor);
    singleSelectAccept._unsafeUnwrap();

    expect(singleSelectAccept._unsafeUnwrap()).toBe('singleSelect');

    const multipleSelect = MultipleSelectField.create({
      id,
      name,
      options: [option],
      defaultValue: selectDefaultResult._unsafeUnwrap(),
      preventAutoNewOptions: selectAutoResult._unsafeUnwrap(),
    });
    multipleSelect._unsafeUnwrap();

    expect(multipleSelect._unsafeUnwrap().selectOptions().length).toBe(1);
    expect(multipleSelect._unsafeUnwrap().defaultValue()).toBe(selectDefaultResult._unsafeUnwrap());
    expect(multipleSelect._unsafeUnwrap().preventAutoNewOptions()).toBe(
      selectAutoResult._unsafeUnwrap()
    );
    const multipleSelectAccept = multipleSelect._unsafeUnwrap().accept(visitor);
    multipleSelectAccept._unsafeUnwrap();

    expect(multipleSelectAccept._unsafeUnwrap()).toBe('multipleSelect');

    const checkbox = CheckboxField.create({
      id,
      name,
      defaultValue: checkboxDefaultResult._unsafeUnwrap(),
    });
    checkbox._unsafeUnwrap();

    expect(checkbox._unsafeUnwrap().defaultValue()).toBe(checkboxDefaultResult._unsafeUnwrap());
    const checkboxAccept = checkbox._unsafeUnwrap().accept(visitor);
    checkboxAccept._unsafeUnwrap();

    expect(checkboxAccept._unsafeUnwrap()).toBe('checkbox');

    const attachment = AttachmentField.create({ id, name });
    attachment._unsafeUnwrap();

    const attachmentAccept = attachment._unsafeUnwrap().accept(visitor);
    attachmentAccept._unsafeUnwrap();

    expect(attachmentAccept._unsafeUnwrap()).toBe('attachment');

    const dateField = DateField.create({
      id,
      name,
      formatting: dateFormattingResult._unsafeUnwrap(),
      defaultValue: dateDefaultResult._unsafeUnwrap(),
    });
    dateField._unsafeUnwrap();

    expect(dateField._unsafeUnwrap().formatting()).toBe(dateFormattingResult._unsafeUnwrap());
    expect(dateField._unsafeUnwrap().defaultValue()).toBe(dateDefaultResult._unsafeUnwrap());
    const dateAccept = dateField._unsafeUnwrap().accept(visitor);
    dateAccept._unsafeUnwrap();

    expect(dateAccept._unsafeUnwrap()).toBe('date');

    const createdTimeField = CreatedTimeField.create({
      id,
      name,
      formatting: dateFormattingResult._unsafeUnwrap(),
    });
    createdTimeField._unsafeUnwrap();

    expect(createdTimeField._unsafeUnwrap().formatting()).toBe(
      dateFormattingResult._unsafeUnwrap()
    );
    const createdTimeAccept = createdTimeField._unsafeUnwrap().accept(visitor);
    createdTimeAccept._unsafeUnwrap();

    expect(createdTimeAccept._unsafeUnwrap()).toBe('createdTime');

    const lastModifiedTimeField = LastModifiedTimeField.create({
      id,
      name,
      formatting: dateFormattingResult._unsafeUnwrap(),
      trackedFieldIds: [id],
    });
    lastModifiedTimeField._unsafeUnwrap();

    expect(lastModifiedTimeField._unsafeUnwrap().formatting()).toBe(
      dateFormattingResult._unsafeUnwrap()
    );
    expect(lastModifiedTimeField._unsafeUnwrap().trackedFieldIds().length).toBe(1);
    const lastModifiedTimeAccept = lastModifiedTimeField._unsafeUnwrap().accept(visitor);
    lastModifiedTimeAccept._unsafeUnwrap();

    expect(lastModifiedTimeAccept._unsafeUnwrap()).toBe('lastModifiedTime');

    const userField = UserField.create({
      id,
      name,
      isMultiple: userMultiplicityResult._unsafeUnwrap(),
      shouldNotify: userNotificationResult._unsafeUnwrap(),
      defaultValue: userDefaultResult._unsafeUnwrap(),
    });
    userField._unsafeUnwrap();

    expect(userField._unsafeUnwrap().multiplicity()).toBe(userMultiplicityResult._unsafeUnwrap());
    expect(userField._unsafeUnwrap().notification()).toBe(userNotificationResult._unsafeUnwrap());
    expect(userField._unsafeUnwrap().defaultValue()).toBe(userDefaultResult._unsafeUnwrap());
    const userAccept = userField._unsafeUnwrap().accept(visitor);
    userAccept._unsafeUnwrap();

    expect(userAccept._unsafeUnwrap()).toBe('user');

    const createdByField = CreatedByField.create({ id, name });
    createdByField._unsafeUnwrap();

    const createdByAccept = createdByField._unsafeUnwrap().accept(visitor);
    createdByAccept._unsafeUnwrap();

    expect(createdByAccept._unsafeUnwrap()).toBe('createdBy');

    const lastModifiedByField = LastModifiedByField.create({
      id,
      name,
      trackedFieldIds: [id],
    });
    lastModifiedByField._unsafeUnwrap();

    expect(lastModifiedByField._unsafeUnwrap().trackedFieldIds().length).toBe(1);
    const lastModifiedByAccept = lastModifiedByField._unsafeUnwrap().accept(visitor);
    lastModifiedByAccept._unsafeUnwrap();

    expect(lastModifiedByAccept._unsafeUnwrap()).toBe('lastModifiedBy');

    const autoNumberField = AutoNumberField.create({ id, name });
    autoNumberField._unsafeUnwrap();

    const autoNumberAccept = autoNumberField._unsafeUnwrap().accept(visitor);
    autoNumberAccept._unsafeUnwrap();

    expect(autoNumberAccept._unsafeUnwrap()).toBe('autoNumber');

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

    expect(buttonField._unsafeUnwrap().label()).toBe(buttonLabelResult._unsafeUnwrap());
    expect(buttonField._unsafeUnwrap().color()).toBe(buttonColorResult._unsafeUnwrap());
    expect(buttonField._unsafeUnwrap().maxCount()).toBe(buttonMaxResult._unsafeUnwrap());
    expect(buttonField._unsafeUnwrap().resetCount()).toBe(buttonResetResult._unsafeUnwrap());
    expect(buttonField._unsafeUnwrap().workflow()).toBe(buttonWorkflowResult._unsafeUnwrap());
    const buttonAccept = buttonField._unsafeUnwrap().accept(visitor);
    buttonAccept._unsafeUnwrap();

    expect(buttonAccept._unsafeUnwrap()).toBe('button');

    const linkField = LinkField.create({ id, name, config: linkConfigResult._unsafeUnwrap() });
    linkField._unsafeUnwrap();

    expect(linkField._unsafeUnwrap().relationship().equals(LinkRelationship.manyOne())).toBe(true);
    expect(linkField._unsafeUnwrap().isMultipleValue()).toBe(false);
    const orderColumnResult = linkField._unsafeUnwrap().orderColumnName();
    orderColumnResult._unsafeUnwrap();

    expect(orderColumnResult._unsafeUnwrap()).toBe('__fk_field_order');
    const linkAccept = linkField._unsafeUnwrap().accept(visitor);
    linkAccept._unsafeUnwrap();

    expect(linkAccept._unsafeUnwrap()).toBe('link');

    const noopVisitor = new NoopFieldVisitor();
    buttonField._unsafeUnwrap().accept(noopVisitor)._unsafeUnwrap();
  });
});
