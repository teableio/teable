import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import type { Field } from '../domain/table/fields/Field';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { ButtonLabel } from '../domain/table/fields/types/ButtonLabel';
import { ButtonMaxCount } from '../domain/table/fields/types/ButtonMaxCount';
import { ButtonWorkflow } from '../domain/table/fields/types/ButtonWorkflow';
import { CellValueMultiplicity } from '../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../domain/table/fields/types/CellValueType';
import { CheckboxDefaultValue } from '../domain/table/fields/types/CheckboxDefaultValue';
import { DateTimeFormatting } from '../domain/table/fields/types/DateTimeFormatting';
import { FieldColor } from '../domain/table/fields/types/FieldColor';
import { FormulaExpression } from '../domain/table/fields/types/FormulaExpression';
import { NumberDefaultValue } from '../domain/table/fields/types/NumberDefaultValue';
import { NumberFormatting } from '../domain/table/fields/types/NumberFormatting';
import { NumberShowAs, SingleNumberDisplayType } from '../domain/table/fields/types/NumberShowAs';
import { RatingColor } from '../domain/table/fields/types/RatingColor';
import { RatingIcon } from '../domain/table/fields/types/RatingIcon';
import { RatingMax } from '../domain/table/fields/types/RatingMax';
import { SelectAutoNewOptions } from '../domain/table/fields/types/SelectAutoNewOptions';
import { SelectDefaultValue } from '../domain/table/fields/types/SelectDefaultValue';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { SingleLineTextShowAs } from '../domain/table/fields/types/SingleLineTextShowAs';
import { TextDefaultValue } from '../domain/table/fields/types/TextDefaultValue';
import { UserDefaultValue } from '../domain/table/fields/types/UserDefaultValue';
import { UserMultiplicity } from '../domain/table/fields/types/UserMultiplicity';
import { UserNotification } from '../domain/table/fields/types/UserNotification';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { UpdateSingleSelectOptionsSpec } from '../domain/table/specs/field-updates/UpdateSingleSelectOptionsSpec';
import { TableUpdateFieldAiConfigSpec } from '../domain/table/specs/TableUpdateFieldAiConfigSpec';
import { TableUpdateFieldDbFieldNameSpec } from '../domain/table/specs/TableUpdateFieldDbFieldNameSpec';
import { TableUpdateFieldDescriptionSpec } from '../domain/table/specs/TableUpdateFieldDescriptionSpec';
import { buildUpdateFieldSpecs, parseUpdateFieldSpec } from './TableFieldUpdateSpecs';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const TEXT_DEFAULT_ALPHA = TextDefaultValue.create('Alpha')._unsafeUnwrap();
const TEXT_DEFAULT_BETA = TextDefaultValue.create('Beta')._unsafeUnwrap();
const NUMBER_DEFAULT_ONE = NumberDefaultValue.create(1)._unsafeUnwrap();
const NUMBER_SHOW_AS_BAR = NumberShowAs.create({
  type: SingleNumberDisplayType.Bar,
  color: 'blue',
  showValue: true,
  maxValue: 100,
})._unsafeUnwrap();
const DATE_FORMATTING_UTC = DateTimeFormatting.create({
  date: 'YYYY-MM-DD',
  time: 'HH:mm',
  timeZone: 'utc',
})._unsafeUnwrap();
const CHECKBOX_DEFAULT_FALSE = CheckboxDefaultValue.create(false)._unsafeUnwrap();
const SINGLE_LINE_EMAIL = SingleLineTextShowAs.create({ type: 'email' })._unsafeUnwrap();
const SELECT_TODO = SelectOption.create({ name: 'Todo', color: 'blue' })._unsafeUnwrap();
const SELECT_DONE = SelectOption.create({ name: 'Done', color: 'green' })._unsafeUnwrap();
const SELECT_DEFAULT_TODO = SelectDefaultValue.create('Todo')._unsafeUnwrap();
const SELECT_DEFAULT_MULTI = SelectDefaultValue.create(['Todo'])._unsafeUnwrap();
const SELECT_ALLOW_AUTO = SelectAutoNewOptions.allow();
const USER_SINGLE = UserMultiplicity.single();
const USER_NOTIFY_ON = UserNotification.enabled();
const USER_DEFAULT_ME = UserDefaultValue.create(['me'])._unsafeUnwrap();
const BUTTON_LABEL_RUN = ButtonLabel.create('Run')._unsafeUnwrap();
const BUTTON_MAX_THREE = ButtonMaxCount.create(3)._unsafeUnwrap();
const BUTTON_WORKFLOW = ButtonWorkflow.create({
  id: 'wfl12345678901234',
  name: 'Deploy',
  isActive: true,
})._unsafeUnwrap()!;
const BUTTON_COLOR_TEAL = FieldColor.from('teal');
const FORMULA_NUMBER_FORMATTING = NumberFormatting.create({
  type: 'decimal',
  precision: 1,
})._unsafeUnwrap();
const RATING_MAX_FIVE = RatingMax.five();
const RATING_ICON_STAR = RatingIcon.star();
const RATING_COLOR_YELLOW = RatingColor.yellowBright();

type Builder = ReturnType<typeof Table.builder>;

type Harness = {
  currentField: Field;
  primaryField: Field;
};

type SameTypeCase = {
  name: string;
  prepare: () => {
    currentField: Field;
    input: Record<string, unknown>;
    expectedSpecNames: string[];
    assertSpecs?: (specs: unknown[]) => void;
  };
};

const setStableDbFieldName = (field: Field, raw: string) => {
  field.setDbFieldName(DbFieldName.rehydrate(raw)._unsafeUnwrap())._unsafeUnwrap();
};

const buildHarness = (
  seed: string,
  targetSeed: string,
  configure: (builder: Builder, targetFieldId: FieldId, primaryFieldId: FieldId) => void
): Harness => {
  const primaryFieldId = createFieldId('p');
  const targetFieldId = createFieldId(targetSeed);
  const builder = Table.builder()
    .withBaseId(createBaseId(seed))
    .withId(createTableId(seed))
    .withName(TableName.create(`Table ${seed}`)._unsafeUnwrap());

  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Primary')._unsafeUnwrap())
    .primary()
    .done();
  configure(builder, targetFieldId, primaryFieldId);
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  return {
    currentField: table.getField((field) => field.id().equals(targetFieldId))._unsafeUnwrap(),
    primaryField: table.getField((field) => field.id().equals(primaryFieldId))._unsafeUnwrap(),
  };
};

const sameTypeCases: SameTypeCase[] = [
  {
    name: 'singleLineText',
    prepare: () => {
      const { currentField } = buildHarness('a', 'a', (builder, fieldId) => {
        builder
          .field()
          .singleLineText()
          .withId(fieldId)
          .withName(FieldName.create('Title')._unsafeUnwrap())
          .withShowAs(SINGLE_LINE_EMAIL)
          .withDefaultValue(TEXT_DEFAULT_ALPHA)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_text_column');

      return {
        currentField,
        input: {
          name: 'Title 2',
          options: {
            showAs: { type: 'url' },
            defaultValue: 'Beta',
          },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateSingleLineTextShowAsSpec',
          'UpdateSingleLineTextDefaultValueSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
  {
    name: 'longText',
    prepare: () => {
      const { currentField } = buildHarness('b', 'b', (builder, fieldId) => {
        builder
          .field()
          .longText()
          .withId(fieldId)
          .withName(FieldName.create('Notes')._unsafeUnwrap())
          .withDefaultValue(TEXT_DEFAULT_ALPHA)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_long_text_column');

      return {
        currentField,
        input: {
          name: 'Notes 2',
          options: { defaultValue: 'Beta' },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateLongTextDefaultValueSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
  {
    name: 'number',
    prepare: () => {
      const { currentField } = buildHarness('c', 'c', (builder, fieldId) => {
        builder
          .field()
          .number()
          .withId(fieldId)
          .withName(FieldName.create('Amount')._unsafeUnwrap())
          .withShowAs(NUMBER_SHOW_AS_BAR)
          .withDefaultValue(NUMBER_DEFAULT_ONE)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_number_column');

      return {
        currentField,
        input: {
          name: 'Amount 2',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'ring', color: 'red', showValue: false, maxValue: 10 },
            defaultValue: 2,
          },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateNumberFormattingSpec',
          'UpdateNumberShowAsSpec',
          'UpdateNumberDefaultValueSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
  {
    name: 'rating',
    prepare: () => {
      const { currentField } = buildHarness('d', 'd', (builder, fieldId) => {
        builder
          .field()
          .rating()
          .withId(fieldId)
          .withName(FieldName.create('Score')._unsafeUnwrap())
          .withMax(RATING_MAX_FIVE)
          .withIcon(RATING_ICON_STAR)
          .withColor(RATING_COLOR_YELLOW)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_rating_column');

      return {
        currentField,
        input: {
          name: 'Score 2',
          max: 3,
          options: {
            icon: 'heart',
            color: 'redBright',
          },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateRatingMaxSpec',
          'UpdateRatingIconSpec',
          'UpdateRatingColorSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
  {
    name: 'date',
    prepare: () => {
      const { currentField } = buildHarness('e', 'e', (builder, fieldId) => {
        builder
          .field()
          .date()
          .withId(fieldId)
          .withName(FieldName.create('Due')._unsafeUnwrap())
          .done();
      });
      setStableDbFieldName(currentField, 'stable_date_column');

      return {
        currentField,
        input: {
          name: 'Due 2',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateDateFormattingSpec',
          'UpdateDateDefaultValueSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
  {
    name: 'checkbox',
    prepare: () => {
      const { currentField } = buildHarness('f', 'f', (builder, fieldId) => {
        builder
          .field()
          .checkbox()
          .withId(fieldId)
          .withName(FieldName.create('Done')._unsafeUnwrap())
          .withDefaultValue(CHECKBOX_DEFAULT_FALSE)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_checkbox_column');

      return {
        currentField,
        input: {
          name: 'Done 2',
          options: { defaultValue: true },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateCheckboxDefaultValueSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
  {
    name: 'createdTime',
    prepare: () => {
      const { currentField } = buildHarness('g', 'g', (builder, fieldId) => {
        builder
          .field()
          .createdTime()
          .withId(fieldId)
          .withName(FieldName.create('Created')._unsafeUnwrap())
          .done();
      });

      return {
        currentField,
        input: {
          name: 'Created 2',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        },
        expectedSpecNames: ['TableUpdateFieldNameSpec', 'TableUpdateFieldTypeSpec'],
      };
    },
  },
  {
    name: 'lastModifiedTime',
    prepare: () => {
      const { currentField, primaryField } = buildHarness('h', 'h', (builder, fieldId) => {
        builder
          .field()
          .lastModifiedTime()
          .withId(fieldId)
          .withName(FieldName.create('Updated')._unsafeUnwrap())
          .withFormatting(DATE_FORMATTING_UTC)
          .done();
      });

      return {
        currentField,
        input: {
          name: 'Updated 2',
          options: {
            trackedFieldIds: [primaryField.id().toString()],
          },
        },
        expectedSpecNames: ['TableUpdateFieldNameSpec', 'TableUpdateFieldTypeSpec'],
      };
    },
  },
  {
    name: 'createdBy',
    prepare: () => {
      const { currentField } = buildHarness('i', 'i', (builder, fieldId) => {
        builder
          .field()
          .createdBy()
          .withId(fieldId)
          .withName(FieldName.create('Creator')._unsafeUnwrap())
          .done();
      });

      return {
        currentField,
        input: { name: 'Creator 2' },
        expectedSpecNames: ['TableUpdateFieldNameSpec'],
      };
    },
  },
  {
    name: 'lastModifiedBy',
    prepare: () => {
      const { currentField, primaryField } = buildHarness('j', 'j', (builder, fieldId) => {
        builder
          .field()
          .lastModifiedBy()
          .withId(fieldId)
          .withName(FieldName.create('Editor')._unsafeUnwrap())
          .done();
      });

      return {
        currentField,
        input: {
          name: 'Editor 2',
          options: {
            trackedFieldIds: [primaryField.id().toString()],
          },
        },
        expectedSpecNames: ['TableUpdateFieldNameSpec', 'TableUpdateFieldTypeSpec'],
      };
    },
  },
  {
    name: 'autoNumber',
    prepare: () => {
      const { currentField } = buildHarness('k', 'k', (builder, fieldId) => {
        builder
          .field()
          .autoNumber()
          .withId(fieldId)
          .withName(FieldName.create('Auto')._unsafeUnwrap())
          .done();
      });

      return {
        currentField,
        input: { name: 'Auto 2' },
        expectedSpecNames: ['TableUpdateFieldNameSpec'],
      };
    },
  },
  {
    name: 'singleSelect',
    prepare: () => {
      const { currentField } = buildHarness('l', 'l', (builder, fieldId) => {
        builder
          .field()
          .singleSelect()
          .withId(fieldId)
          .withName(FieldName.create('Status')._unsafeUnwrap())
          .withOptions([SELECT_TODO])
          .withDefaultValue(SELECT_DEFAULT_TODO)
          .withPreventAutoNewOptions(SELECT_ALLOW_AUTO)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_single_select_column');

      return {
        currentField,
        input: {
          name: 'Status 2',
          options: {
            choices: ['Doing', { name: 'Done' }],
            defaultValue: 'Done',
            preventAutoNewOptions: true,
          },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateSingleSelectOptionsSpec',
          'UpdateSingleSelectDefaultValueSpec',
          'UpdateSingleSelectAutoNewOptionsSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
        assertSpecs: (specs) => {
          const optionsSpec = specs.find(
            (spec): spec is UpdateSingleSelectOptionsSpec =>
              spec instanceof UpdateSingleSelectOptionsSpec
          );
          expect(optionsSpec).toBeDefined();
          expect(optionsSpec?.nextOptions().map((option) => option.toDto().color)).toEqual([
            'blueLight2',
            'blueLight1',
          ]);
        },
      };
    },
  },
  {
    name: 'multipleSelect',
    prepare: () => {
      const { currentField } = buildHarness('m', 'm', (builder, fieldId) => {
        builder
          .field()
          .multipleSelect()
          .withId(fieldId)
          .withName(FieldName.create('Tags')._unsafeUnwrap())
          .withOptions([SELECT_TODO, SELECT_DONE])
          .withDefaultValue(SELECT_DEFAULT_MULTI)
          .withPreventAutoNewOptions(SELECT_ALLOW_AUTO)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_multiple_select_column');

      return {
        currentField,
        input: {
          name: 'Tags 2',
          options: {
            choices: [{ name: 'Todo', color: 'blue' }, { name: 'Done', color: 'green' }, 'Blocked'],
            defaultValue: ['Todo', 'Done'],
            preventAutoNewOptions: true,
          },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateMultipleSelectOptionsSpec',
          'UpdateMultipleSelectDefaultValueSpec',
          'UpdateMultipleSelectAutoNewOptionsSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
  {
    name: 'formula',
    prepare: () => {
      const { currentField } = buildHarness('n', 'n', (builder, fieldId) => {
        builder
          .field()
          .formula()
          .withId(fieldId)
          .withName(FieldName.create('Calc')._unsafeUnwrap())
          .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
          .withFormatting(FORMULA_NUMBER_FORMATTING)
          .withShowAs(NUMBER_SHOW_AS_BAR)
          .withResultType({
            cellValueType: CellValueType.number(),
            isMultipleCellValue: CellValueMultiplicity.single(),
          })
          .done();
      });

      return {
        currentField,
        input: {
          name: 'Calc 2',
          options: {
            expression: '2',
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: null,
          },
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateFormulaExpressionSpec',
          'UpdateFormulaTimeZoneSpec',
          'UpdateFormulaFormattingSpec',
          'UpdateFormulaShowAsSpec',
        ],
      };
    },
  },
  {
    name: 'user',
    prepare: () => {
      const { currentField } = buildHarness('o', 'o', (builder, fieldId) => {
        builder
          .field()
          .user()
          .withId(fieldId)
          .withName(FieldName.create('Owner')._unsafeUnwrap())
          .withMultiplicity(USER_SINGLE)
          .withNotification(USER_NOTIFY_ON)
          .withDefaultValue(USER_DEFAULT_ME)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_user_column');

      return {
        currentField,
        input: {
          name: 'Owner 2',
          options: {
            isMultiple: true,
            shouldNotify: false,
            defaultValue: ['me', 'usr2'],
          },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateUserMultiplicitySpec',
          'UpdateUserNotificationSpec',
          'UpdateUserDefaultValueSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
  {
    name: 'button',
    prepare: () => {
      const { currentField } = buildHarness('q', 'q', (builder, fieldId) => {
        builder
          .field()
          .button()
          .withId(fieldId)
          .withName(FieldName.create('Action')._unsafeUnwrap())
          .withLabel(BUTTON_LABEL_RUN)
          .withColor(BUTTON_COLOR_TEAL)
          .withMaxCount(BUTTON_MAX_THREE)
          .withWorkflow(BUTTON_WORKFLOW)
          .done();
      });
      setStableDbFieldName(currentField, 'stable_button_column');

      return {
        currentField,
        input: {
          name: 'Action 2',
          options: {
            label: 'Ship',
            color: 'blue',
            workflow: null,
          },
          notNull: true,
          unique: true,
        },
        expectedSpecNames: [
          'TableUpdateFieldNameSpec',
          'UpdateButtonLabelSpec',
          'UpdateButtonColorSpec',
          'UpdateButtonMaxCountSpec',
          'UpdateButtonWorkflowSpec',
          'TableUpdateFieldConstraintsSpec',
        ],
      };
    },
  },
];

describe('TableFieldUpdateSpecs same-type updates', () => {
  it.each(sameTypeCases)('builds non-conversion specs for $name', ({ prepare }) => {
    const { currentField, input, expectedSpecNames, assertSpecs } = prepare();

    const specResult = parseUpdateFieldSpec(currentField, input);
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) {
      return;
    }

    const updateSpec = specResult.value;
    expect(updateSpec.isTypeConversion()).toBe(false);
    expect(updateSpec.createField().isErr()).toBe(true);
    expect(updateSpec.foreignTableReferences()._unsafeUnwrap()).toEqual([]);

    const specsResult = updateSpec.buildSpecs(currentField);
    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) {
      return;
    }

    const specNames = specsResult.value.map((spec) => spec.constructor.name).sort();
    expect(specNames).toEqual([...expectedSpecNames].sort());
    assertSpecs?.([...specsResult.value]);
  });

  it('adds dbFieldName, description, and aiConfig specs when field metadata changes', () => {
    const { currentField } = buildHarness('r', 'r', (builder, fieldId) => {
      builder
        .field()
        .singleLineText()
        .withId(fieldId)
        .withName(FieldName.create('Title')._unsafeUnwrap())
        .done();
    });
    currentField
      .setDbFieldName(DbFieldName.rehydrate('stable_current_column')._unsafeUnwrap())
      ._unsafeUnwrap();
    currentField.setDescription('Old description')._unsafeUnwrap();

    const specsResult = buildUpdateFieldSpecs(currentField, {
      dbFieldName: 'next_column_name',
      description: 'New description',
      aiConfig: { prompt: 'fill this field' },
    });

    expect(specsResult.isOk()).toBe(true);
    if (specsResult.isErr()) {
      return;
    }

    expect(specsResult.value.some((spec) => spec instanceof TableUpdateFieldDbFieldNameSpec)).toBe(
      true
    );
    expect(specsResult.value.some((spec) => spec instanceof TableUpdateFieldDescriptionSpec)).toBe(
      true
    );
    expect(specsResult.value.some((spec) => spec instanceof TableUpdateFieldAiConfigSpec)).toBe(
      true
    );
  });

  it.each([
    {
      name: 'lastModifiedTime',
      buildField: () =>
        buildHarness('s', 's', (builder, fieldId) => {
          builder
            .field()
            .lastModifiedTime()
            .withId(fieldId)
            .withName(FieldName.create('Updated')._unsafeUnwrap())
            .withFormatting(DATE_FORMATTING_UTC)
            .done();
        }).currentField,
    },
    {
      name: 'lastModifiedBy',
      buildField: () =>
        buildHarness('t', 't', (builder, fieldId) => {
          builder
            .field()
            .lastModifiedBy()
            .withId(fieldId)
            .withName(FieldName.create('Editor')._unsafeUnwrap())
            .done();
        }).currentField,
    },
  ])('rejects invalid trackedFieldIds for $name', ({ buildField }) => {
    const specResult = parseUpdateFieldSpec(buildField(), {
      options: {
        trackedFieldIds: 'invalid',
      },
    });

    expect(specResult.isErr()).toBe(true);
    expect(specResult._unsafeUnwrapErr().message).toContain('Invalid trackedFieldIds');
  });

  it('rejects invalid formula formatting and showAs payloads', () => {
    const { currentField } = buildHarness('u', 'u', (builder, fieldId) => {
      builder
        .field()
        .formula()
        .withId(fieldId)
        .withName(FieldName.create('Calc')._unsafeUnwrap())
        .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
        .withResultType({
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        })
        .done();
    });

    const invalidFormatting = parseUpdateFieldSpec(currentField, {
      options: {
        formatting: { nope: true },
      },
    });
    expect(invalidFormatting.isErr()).toBe(true);
    expect(invalidFormatting._unsafeUnwrapErr().message).toContain('Invalid FormulaFormatting');

    const invalidShowAs = parseUpdateFieldSpec(currentField, {
      options: {
        showAs: { nope: true },
      },
    });
    expect(invalidShowAs.isErr()).toBe(true);
    expect(invalidShowAs._unsafeUnwrapErr().message).toContain('Invalid FormulaShowAs');
  });
});
