import { describe, expect, it } from 'vitest';

import {
  createAttachmentField,
  createAutoNumberField,
  createButtonField,
  createCheckboxField,
  createConditionalLookupField,
  createConditionalRollupField,
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
  createUserField,
} from '../FieldFactory';
import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { ButtonLabel } from '../types/ButtonLabel';
import { ButtonMaxCount } from '../types/ButtonMaxCount';
import { ButtonResetCount } from '../types/ButtonResetCount';
import { ButtonWorkflow } from '../types/ButtonWorkflow';
import { CellValueMultiplicity } from '../types/CellValueMultiplicity';
import { CellValueType } from '../types/CellValueType';
import { CheckboxDefaultValue } from '../types/CheckboxDefaultValue';
import { ConditionalLookupOptions } from '../types/ConditionalLookupOptions';
import { ConditionalRollupConfig } from '../types/ConditionalRollupConfig';
import { DateDefaultValue } from '../types/DateDefaultValue';
import { DateTimeFormatting } from '../types/DateTimeFormatting';
import { FieldColor } from '../types/FieldColor';
import { FormulaExpression } from '../types/FormulaExpression';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { LinkRelationship } from '../types/LinkRelationship';
import { LookupField } from '../types/LookupField';
import { LookupOptions } from '../types/LookupOptions';
import { LongTextShowAs } from '../types/LongTextShowAs';
import { NumberDefaultValue } from '../types/NumberDefaultValue';
import { NumberFormatting, NumberFormattingType } from '../types/NumberFormatting';
import { NumberShowAs, SingleNumberDisplayType } from '../types/NumberShowAs';
import { RatingColor } from '../types/RatingColor';
import { RatingIcon } from '../types/RatingIcon';
import { RatingMax } from '../types/RatingMax';
import { RollupExpression } from '../types/RollupExpression';
import { RollupFieldConfig } from '../types/RollupFieldConfig';
import { SelectAutoNewOptions } from '../types/SelectAutoNewOptions';
import { SelectDefaultValue } from '../types/SelectDefaultValue';
import { SelectOption } from '../types/SelectOption';
import { SingleLineTextShowAs } from '../types/SingleLineTextShowAs';
import { TextDefaultValue } from '../types/TextDefaultValue';
import { TimeZone } from '../types/TimeZone';
import { UserDefaultValue } from '../types/UserDefaultValue';
import { UserMultiplicity } from '../types/UserMultiplicity';
import { UserNotification } from '../types/UserNotification';
import { FieldOptionsDtoVisitor } from './FieldOptionsDtoVisitor';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldName = (name: string) => FieldName.create(name)._unsafeUnwrap();

const visitResult = (field: { accept: (visitor: FieldOptionsDtoVisitor) => unknown }) =>
  field.accept(new FieldOptionsDtoVisitor()) as ReturnType<typeof LookupField.prototype.accept>;

const visit = (field: { accept: (visitor: FieldOptionsDtoVisitor) => unknown }) =>
  visitResult(field)._unsafeUnwrap();

describe('FieldOptionsDtoVisitor', () => {
  it('serializes text and number-like fields with and without optional values', () => {
    const textDefault = TextDefaultValue.create('hello@example.com')._unsafeUnwrap();
    const singleLineShowAs = SingleLineTextShowAs.create({ type: 'email' })._unsafeUnwrap();
    const longTextShowAs = LongTextShowAs.create({ type: 'markdown' })._unsafeUnwrap();
    const numberFormatting = NumberFormatting.create({
      type: NumberFormattingType.Currency,
      precision: 2,
      symbol: '$',
    })._unsafeUnwrap();
    const numberShowAs = NumberShowAs.create({
      type: SingleNumberDisplayType.Bar,
      color: 'teal',
      showValue: true,
      maxValue: 100,
    })._unsafeUnwrap();
    const numberDefault = NumberDefaultValue.create(42)._unsafeUnwrap();

    const singleLineText = createSingleLineTextField({
      id: createFieldId('a'),
      name: createFieldName('Email'),
      showAs: singleLineShowAs,
      defaultValue: textDefault,
    })._unsafeUnwrap();
    const minimalSingleLineText = createSingleLineTextField({
      id: createFieldId('b'),
      name: createFieldName('Plain Text'),
    })._unsafeUnwrap();
    const longText = createLongTextField({
      id: createFieldId('c'),
      name: createFieldName('Markdown'),
      showAs: longTextShowAs,
      defaultValue: textDefault,
    })._unsafeUnwrap();
    const minimalLongText = createLongTextField({
      id: createFieldId('d'),
      name: createFieldName('Long Text'),
    })._unsafeUnwrap();
    const numberField = createNumberField({
      id: createFieldId('e'),
      name: createFieldName('Amount'),
      formatting: numberFormatting,
      showAs: numberShowAs,
      defaultValue: numberDefault,
    })._unsafeUnwrap();
    const minimalNumberField = createNumberField({
      id: createFieldId('f'),
      name: createFieldName('Count'),
    })._unsafeUnwrap();

    expect(visit(singleLineText)).toEqual({
      showAs: singleLineShowAs.toDto(),
      defaultValue: 'hello@example.com',
    });
    expect(visit(minimalSingleLineText)).toEqual({});
    expect(visit(longText)).toEqual({
      showAs: longTextShowAs.toDto(),
      defaultValue: 'hello@example.com',
    });
    expect(visit(minimalLongText)).toEqual({});
    expect(visit(numberField)).toEqual({
      formatting: numberFormatting.toDto(),
      showAs: numberShowAs.toDto(),
      defaultValue: 42,
    });
    expect(visit(minimalNumberField)).toEqual({
      formatting: NumberFormatting.default().toDto(),
    });
  });

  it('serializes computed field options and lookup delegation paths', () => {
    const expression = FormulaExpression.create('1')._unsafeUnwrap();
    const timeZone = TimeZone.default();
    const numberFormatting = NumberFormatting.default();
    const numberShowAs = NumberShowAs.create({
      type: SingleNumberDisplayType.Bar,
      color: 'blue',
      showValue: true,
      maxValue: 10,
    })._unsafeUnwrap();
    const valuesField = createNumberField({
      id: createFieldId('g'),
      name: createFieldName('Values'),
    })._unsafeUnwrap();
    const numberField = createNumberField({
      id: createFieldId('S'),
      name: createFieldName('Lookup Number'),
    })._unsafeUnwrap();
    const linkFieldId = createFieldId('h');
    const lookupFieldId = createFieldId('i');
    const foreignTableId = `tbl${'z'.repeat(16)}`;

    const formulaFieldResult = createFormulaField({
      id: createFieldId('j'),
      name: createFieldName('Formula'),
      expression,
      timeZone,
      formatting: numberFormatting,
      showAs: numberShowAs,
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    });
    const minimalFormulaFieldResult = createFormulaField({
      id: createFieldId('k'),
      name: createFieldName('Minimal Formula'),
      expression,
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    });
    const rollupFieldResult = createRollupField({
      id: createFieldId('l'),
      name: createFieldName('Rollup'),
      config: RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId,
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      valuesField,
      timeZone,
      formatting: numberFormatting,
      showAs: numberShowAs,
    });
    const minimalRollupFieldResult = createRollupField({
      id: createFieldId('m'),
      name: createFieldName('Minimal Rollup'),
      config: RollupFieldConfig.create({
        linkFieldId: linkFieldId.toString(),
        foreignTableId,
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
      expression: RollupExpression.create('countall({values})')._unsafeUnwrap(),
      valuesField,
    });
    const conditionalRollupFieldResult = createConditionalRollupField({
      id: createFieldId('n'),
      name: createFieldName('Conditional Rollup'),
      config: ConditionalRollupConfig.create({
        foreignTableId,
        lookupFieldId: lookupFieldId.toString(),
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: createFieldId('o').toString(), operator: 'is', value: 'Open' }],
          },
        },
      })._unsafeUnwrap(),
      expression: RollupExpression.create('sum({values})')._unsafeUnwrap(),
      valuesField,
      timeZone,
      formatting: numberFormatting,
      showAs: numberShowAs,
    });
    const minimalConditionalRollupFieldResult = createConditionalRollupField({
      id: createFieldId('p'),
      name: createFieldName('Minimal Conditional Rollup'),
      config: ConditionalRollupConfig.create({
        foreignTableId,
        lookupFieldId: lookupFieldId.toString(),
        condition: { filter: null },
      })._unsafeUnwrap(),
      expression: RollupExpression.create('countall({values})')._unsafeUnwrap(),
      valuesField,
    });
    const lookupFieldResult = LookupField.create({
      id: createFieldId('q'),
      name: createFieldName('Lookup'),
      innerField: numberField,
      lookupOptions: LookupOptions.create({
        foreignTableId,
        linkFieldId: linkFieldId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
    });
    const pendingLookupFieldResult = LookupField.createPending({
      id: createFieldId('r'),
      name: createFieldName('Pending Lookup'),
      lookupOptions: LookupOptions.create({
        foreignTableId,
        linkFieldId: linkFieldId.toString(),
        lookupFieldId: lookupFieldId.toString(),
      })._unsafeUnwrap(),
    });

    expect(formulaFieldResult.isOk()).toBe(true);
    expect(minimalFormulaFieldResult.isOk()).toBe(true);
    expect(rollupFieldResult.isOk()).toBe(true);
    expect(minimalRollupFieldResult.isOk()).toBe(true);
    expect(conditionalRollupFieldResult.isOk()).toBe(true);
    expect(minimalConditionalRollupFieldResult.isOk()).toBe(true);
    expect(lookupFieldResult.isOk()).toBe(true);
    expect(pendingLookupFieldResult.isOk()).toBe(true);

    const formulaField = formulaFieldResult._unsafeUnwrap();
    const minimalFormulaField = minimalFormulaFieldResult._unsafeUnwrap();
    const rollupField = rollupFieldResult._unsafeUnwrap();
    const minimalRollupField = minimalRollupFieldResult._unsafeUnwrap();
    const conditionalRollupField = conditionalRollupFieldResult._unsafeUnwrap();
    const minimalConditionalRollupField = minimalConditionalRollupFieldResult._unsafeUnwrap();
    const lookupField = lookupFieldResult._unsafeUnwrap();
    const pendingLookupField = pendingLookupFieldResult._unsafeUnwrap();

    const formulaOptions = visitResult(formulaField);
    const minimalFormulaOptions = visitResult(minimalFormulaField);
    const rollupOptions = visitResult(rollupField);
    const minimalRollupOptions = visitResult(minimalRollupField);
    const conditionalRollupOptions = visitResult(conditionalRollupField);
    const minimalConditionalRollupOptions = visitResult(minimalConditionalRollupField);
    const lookupOptions = visitResult(lookupField);
    const pendingLookupOptions = visitResult(pendingLookupField);

    expect(formulaOptions.isOk()).toBe(true);
    expect(minimalFormulaOptions.isOk()).toBe(true);
    expect(rollupOptions.isOk()).toBe(true);
    expect(minimalRollupOptions.isOk()).toBe(true);
    expect(conditionalRollupOptions.isOk()).toBe(true);
    expect(minimalConditionalRollupOptions.isOk()).toBe(true);
    expect(lookupOptions.isOk()).toBe(true);
    expect(pendingLookupOptions.isOk()).toBe(true);

    expect(formulaOptions._unsafeUnwrap()).toEqual({
      expression: '1',
      timeZone: timeZone.toString(),
      formatting: numberFormatting.toDto(),
      showAs: numberShowAs.toDto(),
    });
    expect(minimalFormulaOptions._unsafeUnwrap()).toEqual({ expression: '1' });
    expect(rollupOptions._unsafeUnwrap()).toEqual({
      expression: 'sum({values})',
      timeZone: timeZone.toString(),
      formatting: numberFormatting.toDto(),
      showAs: numberShowAs.toDto(),
    });
    expect(minimalRollupOptions._unsafeUnwrap()).toEqual({
      expression: 'countall({values})',
      formatting: NumberFormatting.default().toDto(),
    });
    expect(conditionalRollupOptions._unsafeUnwrap()).toEqual({
      expression: 'sum({values})',
      timeZone: timeZone.toString(),
      formatting: numberFormatting.toDto(),
      showAs: numberShowAs.toDto(),
    });
    expect(minimalConditionalRollupOptions._unsafeUnwrap()).toEqual({
      expression: 'countall({values})',
      formatting: NumberFormatting.default().toDto(),
    });
    expect(lookupOptions._unsafeUnwrap()).toEqual({
      formatting: NumberFormatting.default().toDto(),
    });
    expect(pendingLookupOptions._unsafeUnwrap()).toEqual({});
  });

  it('serializes selection, checkbox, date and audit-like field options', () => {
    const choice = SelectOption.create({
      id: 'opt_open',
      name: 'Open',
      color: 'yellowBright',
    })._unsafeUnwrap();
    const selectDefault = SelectDefaultValue.create('Open')._unsafeUnwrap();
    const autoNewOptions = SelectAutoNewOptions.create(true)._unsafeUnwrap();
    const checkboxDefault = CheckboxDefaultValue.create(true)._unsafeUnwrap();
    const dateFormatting = DateTimeFormatting.create({
      date: 'YYYY-MM-DD',
      time: 'HH:mm',
      timeZone: 'utc',
    })._unsafeUnwrap();
    const dateDefault = DateDefaultValue.create('now')._unsafeUnwrap();
    const trackedFieldId = createFieldId('s');
    const userDefault = UserDefaultValue.create(['usr_me'])._unsafeUnwrap();

    const singleSelect = createSingleSelectField({
      id: createFieldId('t'),
      name: createFieldName('Status'),
      options: [choice],
      defaultValue: selectDefault,
      preventAutoNewOptions: autoNewOptions,
    })._unsafeUnwrap();
    const minimalMultipleSelect = createMultipleSelectField({
      id: createFieldId('u'),
      name: createFieldName('Tags'),
      options: [choice],
    })._unsafeUnwrap();
    const checkboxField = createCheckboxField({
      id: createFieldId('v'),
      name: createFieldName('Done'),
      defaultValue: checkboxDefault,
    })._unsafeUnwrap();
    const minimalCheckboxField = createCheckboxField({
      id: createFieldId('w'),
      name: createFieldName('Unchecked'),
    })._unsafeUnwrap();
    const dateField = createDateField({
      id: createFieldId('x'),
      name: createFieldName('Due Date'),
      formatting: dateFormatting,
      defaultValue: dateDefault,
    })._unsafeUnwrap();
    const minimalDateField = createDateField({
      id: createFieldId('y'),
      name: createFieldName('Created At'),
    })._unsafeUnwrap();
    const lastModifiedTimeField = createLastModifiedTimeField({
      id: createFieldId('z'),
      name: createFieldName('Updated Time'),
      trackedFieldIds: [trackedFieldId],
    })._unsafeUnwrap();
    const minimalLastModifiedTimeField = createLastModifiedTimeField({
      id: createFieldId('A'),
      name: createFieldName('Any Update'),
    })._unsafeUnwrap();
    const userField = createUserField({
      id: createFieldId('B'),
      name: createFieldName('Assignee'),
      isMultiple: UserMultiplicity.create(true)._unsafeUnwrap(),
      shouldNotify: UserNotification.create(false)._unsafeUnwrap(),
      defaultValue: userDefault,
    })._unsafeUnwrap();
    const minimalUserField = createUserField({
      id: createFieldId('C'),
      name: createFieldName('Reviewer'),
    })._unsafeUnwrap();
    const lastModifiedByField = createLastModifiedByField({
      id: createFieldId('D'),
      name: createFieldName('Updated By'),
      trackedFieldIds: [trackedFieldId],
    })._unsafeUnwrap();
    const minimalLastModifiedByField = createLastModifiedByField({
      id: createFieldId('E'),
      name: createFieldName('Anyone'),
    })._unsafeUnwrap();

    expect(visit(singleSelect)).toEqual({
      choices: [choice.toDto()],
      defaultValue: selectDefault.toDto(),
      preventAutoNewOptions: true,
    });
    expect(visit(minimalMultipleSelect)).toEqual({
      choices: [choice.toDto()],
    });
    expect(visit(checkboxField)).toEqual({ defaultValue: true });
    expect(visit(minimalCheckboxField)).toEqual({});
    expect(visit(dateField)).toEqual({
      formatting: dateFormatting.toDto(),
      defaultValue: 'now',
    });
    expect(visit(minimalDateField)).toEqual({
      formatting: DateTimeFormatting.default().toDto(),
    });
    expect(visit(lastModifiedTimeField)).toEqual({
      expression: lastModifiedTimeField.expression().toString(),
      formatting: DateTimeFormatting.default().toDto(),
      trackedFieldIds: [trackedFieldId.toString()],
    });
    expect(visit(minimalLastModifiedTimeField)).toEqual({
      expression: minimalLastModifiedTimeField.expression().toString(),
      formatting: DateTimeFormatting.default().toDto(),
    });
    expect(visit(userField)).toEqual({
      isMultiple: true,
      shouldNotify: false,
      defaultValue: userDefault.toDto(),
    });
    expect(visit(minimalUserField)).toEqual({
      isMultiple: false,
      shouldNotify: true,
    });
    expect(visit(lastModifiedByField)).toEqual({
      trackedFieldIds: [trackedFieldId.toString()],
    });
    expect(visit(minimalLastModifiedByField)).toEqual({});
  });

  it('serializes simple passthrough and empty-option field types', () => {
    const linkFieldId = createFieldId('F');
    const lookupFieldId = createFieldId('G');
    const foreignTableId = `tbl${'y'.repeat(16)}`;
    const workflow = ButtonWorkflow.create({
      id: `wfl${'a'.repeat(16)}`,
      name: 'Deploy',
      isActive: true,
    })._unsafeUnwrap();
    const conditionalLookupOptions = ConditionalLookupOptions.create({
      foreignTableId,
      lookupFieldId: lookupFieldId.toString(),
      condition: {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: createFieldId('H').toString(), operator: 'is', value: 'Ready' }],
        },
      },
    })._unsafeUnwrap();

    const attachmentField = createAttachmentField({
      id: createFieldId('I'),
      name: createFieldName('Files'),
    })._unsafeUnwrap();
    const createdByField = createCreatedByField({
      id: createFieldId('J'),
      name: createFieldName('Created By'),
    })._unsafeUnwrap();
    const createdTimeField = createCreatedTimeField({
      id: createFieldId('K'),
      name: createFieldName('Created Time'),
    })._unsafeUnwrap();
    const autoNumberField = createAutoNumberField({
      id: createFieldId('L'),
      name: createFieldName('No.'),
    })._unsafeUnwrap();
    const ratingField = createRatingField({
      id: createFieldId('M'),
      name: createFieldName('Priority'),
      icon: RatingIcon.create('star')._unsafeUnwrap(),
      color: RatingColor.create('yellowBright')._unsafeUnwrap(),
      max: RatingMax.create(5)._unsafeUnwrap(),
    })._unsafeUnwrap();
    const buttonField = createButtonField({
      id: createFieldId('N'),
      name: createFieldName('Trigger'),
      label: ButtonLabel.create('Run')._unsafeUnwrap(),
      color: FieldColor.create('teal')._unsafeUnwrap(),
      maxCount: ButtonMaxCount.create(3)._unsafeUnwrap(),
      resetCount: ButtonResetCount.create(true)._unsafeUnwrap(),
      workflow,
    })._unsafeUnwrap();
    const minimalButtonField = createButtonField({
      id: createFieldId('O'),
      name: createFieldName('Plain Button'),
    })._unsafeUnwrap();
    const linkField = createLinkField({
      id: linkFieldId,
      name: createFieldName('Project'),
      config: LinkFieldConfig.create({
        relationship: LinkRelationship.manyOne().toString(),
        foreignTableId,
        lookupFieldId: lookupFieldId.toString(),
        fkHostTableName: 'project_links',
        selfKeyName: '__id',
        foreignKeyName: '__fk_project',
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const conditionalLookupField = createConditionalLookupField({
      id: createFieldId('P'),
      name: createFieldName('Conditional Lookup'),
      innerField: attachmentField,
      conditionalLookupOptions,
    })._unsafeUnwrap();

    expect(visit(attachmentField)).toEqual({});
    expect(visit(createdByField)).toEqual({});
    expect(visit(createdTimeField)).toEqual({
      expression: createdTimeField.expression().toString(),
      formatting: DateTimeFormatting.default().toDto(),
    });
    expect(visit(autoNumberField)).toEqual({
      expression: autoNumberField.expression().toString(),
    });
    expect(visit(ratingField)).toEqual({
      icon: 'star',
      color: 'yellowBright',
      max: 5,
    });
    expect(visit(buttonField)).toEqual({
      label: 'Run',
      color: 'teal',
      maxCount: 3,
      resetCount: true,
      workflow: workflow.toDto(),
    });
    expect(visit(minimalButtonField)).toEqual({
      label: 'Button',
      color: 'teal',
    });
    expect(visit(linkField)).toEqual(linkField.configDto()._unsafeUnwrap());
    expect(visit(conditionalLookupField)).toEqual(conditionalLookupOptions.toDto());
  });
});
