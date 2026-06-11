import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../../../base/BaseId';
import { domainError } from '../../../../shared/DomainError';
import { DbFieldName } from '../../../fields/DbFieldName';
import { FieldId } from '../../../fields/FieldId';
import { FieldName } from '../../../fields/FieldName';
import { CellValueMultiplicity } from '../../../fields/types/CellValueMultiplicity';
import { CellValueType } from '../../../fields/types/CellValueType';
import { CheckboxDefaultValue } from '../../../fields/types/CheckboxDefaultValue';
import { DateDefaultValue } from '../../../fields/types/DateDefaultValue';
import { FieldColor } from '../../../fields/types/FieldColor';
import { FormulaExpression } from '../../../fields/types/FormulaExpression';
import {
  MultiNumberDisplayType,
  NumberShowAs,
  SingleNumberDisplayType,
} from '../../../fields/types/NumberShowAs';
import { NumberDefaultValue } from '../../../fields/types/NumberDefaultValue';
import { NumberFormatting, NumberFormattingType } from '../../../fields/types/NumberFormatting';
import { RatingColor } from '../../../fields/types/RatingColor';
import { RatingIcon } from '../../../fields/types/RatingIcon';
import { RatingMax } from '../../../fields/types/RatingMax';
import { SelectAutoNewOptions } from '../../../fields/types/SelectAutoNewOptions';
import { SelectDefaultValue } from '../../../fields/types/SelectDefaultValue';
import { SelectOption } from '../../../fields/types/SelectOption';
import { TextDefaultValue } from '../../../fields/types/TextDefaultValue';
import { TimeZone } from '../../../fields/types/TimeZone';
import { ButtonLabel } from '../../../fields/types/ButtonLabel';
import { ButtonMaxCount } from '../../../fields/types/ButtonMaxCount';
import { ButtonWorkflow } from '../../../fields/types/ButtonWorkflow';
import { UserDefaultValue } from '../../../fields/types/UserDefaultValue';
import { UserMultiplicity } from '../../../fields/types/UserMultiplicity';
import { UserNotification } from '../../../fields/types/UserNotification';
import { Table } from '../../../Table';
import { TableName } from '../../../TableName';
import * as FieldUpdateSpecs from '..';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const PRIMARY_NAME = FieldName.create('Title')._unsafeUnwrap();

const TEXT_DEFAULT_ALPHA = TextDefaultValue.create('Alpha')._unsafeUnwrap();
const TEXT_DEFAULT_BETA = TextDefaultValue.create('Beta')._unsafeUnwrap();
const NUMBER_DEFAULT_ONE = NumberDefaultValue.create(1)._unsafeUnwrap();
const NUMBER_DEFAULT_TWO = NumberDefaultValue.create(2)._unsafeUnwrap();
const CHECKBOX_DEFAULT_FALSE = CheckboxDefaultValue.create(false)._unsafeUnwrap();
const CHECKBOX_DEFAULT_TRUE = CheckboxDefaultValue.create(true)._unsafeUnwrap();
const DATE_DEFAULT_NOW = DateDefaultValue.create('now')._unsafeUnwrap();
const USER_DEFAULT_ME = UserDefaultValue.create(['me'])._unsafeUnwrap();
const USER_DEFAULT_MULTI = UserDefaultValue.create(['me', 'usr123'])._unsafeUnwrap();
const BUTTON_LABEL_RUN = ButtonLabel.create('Run')._unsafeUnwrap();
const BUTTON_LABEL_SHIP = ButtonLabel.create('Ship')._unsafeUnwrap();
const BUTTON_MAX_THREE = ButtonMaxCount.create(3)._unsafeUnwrap();
const BUTTON_COLOR_TEAL = FieldColor.from('teal');
const BUTTON_COLOR_BLUE = FieldColor.create('blue')._unsafeUnwrap();
const BUTTON_WORKFLOW = ButtonWorkflow.create({
  id: 'wfl12345678901234',
  name: 'Deploy',
  isActive: true,
})._unsafeUnwrap();
const NUMBER_SHOW_AS_BAR = NumberShowAs.create({
  type: SingleNumberDisplayType.Bar,
  color: 'blue',
  showValue: true,
  maxValue: 100,
})._unsafeUnwrap();
const NUMBER_SHOW_AS_RING = NumberShowAs.create({
  type: SingleNumberDisplayType.Ring,
  color: 'red',
  showValue: false,
  maxValue: 10,
})._unsafeUnwrap();
const FORMULA_FORMATTING_DEFAULT = NumberFormatting.default();
const FORMULA_FORMATTING_CURRENCY = NumberFormatting.create({
  type: NumberFormattingType.Currency,
  precision: 2,
  symbol: '$',
})._unsafeUnwrap();
const RATING_MAX_FIVE = RatingMax.five();
const RATING_MAX_THREE = RatingMax.create(3)._unsafeUnwrap();
const RATING_ICON_STAR = RatingIcon.star();
const RATING_ICON_HEART = RatingIcon.create('heart')._unsafeUnwrap();
const RATING_COLOR_YELLOW = RatingColor.yellowBright();
const RATING_COLOR_RED = RatingColor.create('redBright')._unsafeUnwrap();
const SELECT_TODO = SelectOption.create({ name: 'Todo', color: 'blue' })._unsafeUnwrap();
const SELECT_DONE = SelectOption.create({ name: 'Done', color: 'green' })._unsafeUnwrap();
const SELECT_DEFAULT_TODO = SelectDefaultValue.create('Todo')._unsafeUnwrap();
const SELECT_DEFAULT_MULTI = SelectDefaultValue.create(['Todo', 'Done'])._unsafeUnwrap();
const SELECT_ALLOW_AUTO = SelectAutoNewOptions.allow();
const SELECT_PREVENT_AUTO = SelectAutoNewOptions.prevent();
const USER_SINGLE = UserMultiplicity.single();
const USER_MULTIPLE = UserMultiplicity.multiple();
const USER_NOTIFY_ON = UserNotification.enabled();
const USER_NOTIFY_OFF = UserNotification.disabled();
const TIME_ZONE_UTC = TimeZone.default();
const TIME_ZONE_SHANGHAI = TimeZone.create('Asia/Shanghai')._unsafeUnwrap();
const RATING_DB_FIELD_NAME = DbFieldName.rehydrate('fld_rating')._unsafeUnwrap();
const USER_DB_FIELD_NAME = DbFieldName.rehydrate('fld_user')._unsafeUnwrap();

type Case = {
  name: string;
  buildTable: (fieldId: FieldId) => Table;
  buildWrongTypeTable: (fieldId: FieldId) => Table;
  makeSpec: (fieldId: FieldId) => any;
  assertSpec: (spec: any, fieldId: FieldId) => void;
  assertUpdatedField: (field: any) => void;
  expectedVisit: string;
};

type FormulaCase = Case & {
  buildMissingResultTypeTable: (fieldId: FieldId) => Table;
};

const buildTable = (
  seed: string,
  configure: (builder: ReturnType<typeof Table.builder>) => void
) => {
  const builder = Table.builder()
    .withBaseId(createBaseId(seed))
    .withName(TableName.create(`Table ${seed}`)._unsafeUnwrap());

  builder.field().singleLineText().withName(PRIMARY_NAME).done();
  configure(builder);
  builder.view().defaultGrid().done();

  return builder.build()._unsafeUnwrap();
};

const buildPlainTextTable = (fieldId: FieldId) =>
  buildTable('a', (builder) => {
    builder
      .field()
      .singleLineText()
      .withId(fieldId)
      .withName(FieldName.create('Text')._unsafeUnwrap())
      .done();
  });

const buildTextDefaultTable = (fieldId: FieldId, defaultValue = TEXT_DEFAULT_ALPHA) =>
  buildTable('b', (builder) => {
    builder
      .field()
      .singleLineText()
      .withId(fieldId)
      .withName(FieldName.create('Text')._unsafeUnwrap())
      .withDefaultValue(defaultValue)
      .done();
  });

const buildLongTextTable = (fieldId: FieldId, defaultValue = TEXT_DEFAULT_ALPHA) =>
  buildTable('c', (builder) => {
    builder
      .field()
      .longText()
      .withId(fieldId)
      .withName(FieldName.create('Long Text')._unsafeUnwrap())
      .withDefaultValue(defaultValue)
      .done();
  });

const buildNumberTable = (
  fieldId: FieldId,
  options: { defaultValue?: NumberDefaultValue; showAs?: NumberShowAs } = {}
) =>
  buildTable('d', (builder) => {
    const number = builder
      .field()
      .number()
      .withId(fieldId)
      .withName(FieldName.create('Amount')._unsafeUnwrap());
    if (options.defaultValue) number.withDefaultValue(options.defaultValue);
    if (options.showAs) number.withShowAs(options.showAs);
    number.done();
  });

const buildCheckboxTable = (fieldId: FieldId, defaultValue = CHECKBOX_DEFAULT_FALSE) =>
  buildTable('e', (builder) => {
    builder
      .field()
      .checkbox()
      .withId(fieldId)
      .withName(FieldName.create('Done')._unsafeUnwrap())
      .withDefaultValue(defaultValue)
      .done();
  });

const buildDateTable = (fieldId: FieldId, defaultValue = DATE_DEFAULT_NOW) =>
  buildTable('f', (builder) => {
    builder
      .field()
      .date()
      .withId(fieldId)
      .withName(FieldName.create('Due')._unsafeUnwrap())
      .withDefaultValue(defaultValue)
      .done();
  });

const buildSingleSelectTable = (
  fieldId: FieldId,
  options: {
    defaultValue?: SelectDefaultValue;
    preventAutoNewOptions?: SelectAutoNewOptions;
  } = {}
) =>
  buildTable('g', (builder) => {
    const select = builder
      .field()
      .singleSelect()
      .withId(fieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([SELECT_TODO, SELECT_DONE]);
    if (options.defaultValue) select.withDefaultValue(options.defaultValue);
    if (options.preventAutoNewOptions)
      select.withPreventAutoNewOptions(options.preventAutoNewOptions);
    select.done();
  });

const buildMultipleSelectTable = (
  fieldId: FieldId,
  options: {
    defaultValue?: SelectDefaultValue;
    preventAutoNewOptions?: SelectAutoNewOptions;
  } = {}
) =>
  buildTable('h', (builder) => {
    const select = builder
      .field()
      .multipleSelect()
      .withId(fieldId)
      .withName(FieldName.create('Tags')._unsafeUnwrap())
      .withOptions([SELECT_TODO, SELECT_DONE]);
    if (options.defaultValue) select.withDefaultValue(options.defaultValue);
    if (options.preventAutoNewOptions)
      select.withPreventAutoNewOptions(options.preventAutoNewOptions);
    select.done();
  });

const buildUserTable = (
  fieldId: FieldId,
  options: {
    multiplicity?: UserMultiplicity;
    notification?: UserNotification;
    defaultValue?: UserDefaultValue;
  } = {}
) =>
  buildTable('i', (builder) => {
    const user = builder
      .field()
      .user()
      .withId(fieldId)
      .withName(FieldName.create('Owner')._unsafeUnwrap());
    if (options.multiplicity) user.withMultiplicity(options.multiplicity);
    if (options.notification) user.withNotification(options.notification);
    if (options.defaultValue) user.withDefaultValue(options.defaultValue);
    user.done();
  });

const buildButtonTable = (
  fieldId: FieldId,
  options: {
    label?: ButtonLabel;
    color?: FieldColor;
    maxCount?: ButtonMaxCount;
    workflow?: NonNullable<typeof BUTTON_WORKFLOW>;
  } = {}
) =>
  buildTable('j', (builder) => {
    const button = builder
      .field()
      .button()
      .withId(fieldId)
      .withName(FieldName.create('Action')._unsafeUnwrap());
    if (options.label) button.withLabel(options.label);
    if (options.color) button.withColor(options.color);
    if (options.maxCount) button.withMaxCount(options.maxCount);
    if (options.workflow) button.withWorkflow(options.workflow);
    button.done();
  });

const buildRatingTable = (
  fieldId: FieldId,
  options: {
    max?: RatingMax;
    icon?: RatingIcon;
    color?: RatingColor;
  } = {}
) =>
  buildTable('k', (builder) => {
    const rating = builder
      .field()
      .rating()
      .withId(fieldId)
      .withName(FieldName.create('Score')._unsafeUnwrap());
    if (options.max) rating.withMax(options.max);
    if (options.icon) rating.withIcon(options.icon);
    if (options.color) rating.withColor(options.color);
    rating.done();
  });

const buildFormulaTable = (
  fieldId: FieldId,
  options: {
    formatting?: NumberFormatting;
    showAs?: NumberShowAs;
    timeZone?: TimeZone;
    withResultType?: boolean;
  } = {}
) =>
  buildTable('l', (builder) => {
    const formula = builder
      .field()
      .formula()
      .withId(fieldId)
      .withName(FieldName.create('Calc')._unsafeUnwrap())
      .withExpression(FormulaExpression.create('1')._unsafeUnwrap());
    if (options.timeZone) formula.withTimeZone(options.timeZone);
    if (options.formatting) formula.withFormatting(options.formatting);
    if (options.showAs) formula.withShowAs(options.showAs);
    if (options.withResultType !== false) {
      formula.withResultType({
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      });
    }
    formula.done();
  });

const buildFormulaTableWithMissingResultType = (
  fieldId: FieldId,
  options: {
    formatting?: NumberFormatting;
    showAs?: NumberShowAs;
    timeZone?: TimeZone;
  } = {}
) => {
  const table = buildFormulaTable(fieldId, options);
  const field = table.getField((current) => current.id().equals(fieldId))._unsafeUnwrap() as any;
  const missingResultType = err(
    domainError.validation({ message: 'Formula field result type not set' })
  );

  field.cellValueType = () => missingResultType;
  field.isMultipleCellValue = () => missingResultType;

  return table;
};

const createSpyVisitor = () => {
  const calls: string[] = [];
  const visitor = new Proxy(
    {
      visit: () => ok(undefined),
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        return () => {
          calls.push(String(prop));
          return ok(undefined);
        };
      },
    }
  );

  return { calls, visitor };
};

const commonCases: Case[] = [
  {
    name: 'UpdateSingleLineTextDefaultValueSpec',
    buildTable: (fieldId) => buildTextDefaultTable(fieldId),
    buildWrongTypeTable: (fieldId) => buildNumberTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateSingleLineTextDefaultValueSpec.create(
        fieldId,
        TEXT_DEFAULT_ALPHA,
        TEXT_DEFAULT_BETA
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousDefaultValue()).toBe(TEXT_DEFAULT_ALPHA);
      expect(spec.nextDefaultValue()).toBe(TEXT_DEFAULT_BETA);
    },
    assertUpdatedField: (field) => {
      expect(field.defaultValue()?.equals(TEXT_DEFAULT_BETA)).toBe(true);
    },
    expectedVisit: 'visitUpdateSingleLineTextDefaultValue',
  },
  {
    name: 'UpdateLongTextDefaultValueSpec',
    buildTable: (fieldId) => buildLongTextTable(fieldId),
    buildWrongTypeTable: (fieldId) => buildNumberTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateLongTextDefaultValueSpec.create(
        fieldId,
        TEXT_DEFAULT_ALPHA,
        TEXT_DEFAULT_BETA
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousDefaultValue()).toBe(TEXT_DEFAULT_ALPHA);
      expect(spec.nextDefaultValue()).toBe(TEXT_DEFAULT_BETA);
    },
    assertUpdatedField: (field) => {
      expect(field.defaultValue()?.equals(TEXT_DEFAULT_BETA)).toBe(true);
    },
    expectedVisit: 'visitUpdateLongTextDefaultValue',
  },
  {
    name: 'UpdateNumberDefaultValueSpec',
    buildTable: (fieldId) => buildNumberTable(fieldId, { defaultValue: NUMBER_DEFAULT_ONE }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateNumberDefaultValueSpec.create(
        fieldId,
        NUMBER_DEFAULT_ONE,
        NUMBER_DEFAULT_TWO
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousDefaultValue()).toBe(NUMBER_DEFAULT_ONE);
      expect(spec.nextDefaultValue()).toBe(NUMBER_DEFAULT_TWO);
    },
    assertUpdatedField: (field) => {
      expect(field.defaultValue()?.equals(NUMBER_DEFAULT_TWO)).toBe(true);
    },
    expectedVisit: 'visitUpdateNumberDefaultValue',
  },
  {
    name: 'UpdateNumberShowAsSpec',
    buildTable: (fieldId) => buildNumberTable(fieldId, { showAs: NUMBER_SHOW_AS_BAR }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateNumberShowAsSpec.create(
        fieldId,
        NUMBER_SHOW_AS_BAR,
        NUMBER_SHOW_AS_RING
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousShowAs()).toBe(NUMBER_SHOW_AS_BAR);
      expect(spec.nextShowAs()).toBe(NUMBER_SHOW_AS_RING);
    },
    assertUpdatedField: (field) => {
      expect(field.showAs()?.equals(NUMBER_SHOW_AS_RING)).toBe(true);
    },
    expectedVisit: 'visitUpdateNumberShowAs',
  },
  {
    name: 'UpdateCheckboxDefaultValueSpec',
    buildTable: (fieldId) => buildCheckboxTable(fieldId),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateCheckboxDefaultValueSpec.create(
        fieldId,
        CHECKBOX_DEFAULT_FALSE,
        CHECKBOX_DEFAULT_TRUE
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousDefaultValue()).toBe(CHECKBOX_DEFAULT_FALSE);
      expect(spec.nextDefaultValue()).toBe(CHECKBOX_DEFAULT_TRUE);
    },
    assertUpdatedField: (field) => {
      expect(field.defaultValue()?.equals(CHECKBOX_DEFAULT_TRUE)).toBe(true);
    },
    expectedVisit: 'visitUpdateCheckboxDefaultValue',
  },
  {
    name: 'UpdateDateDefaultValueSpec',
    buildTable: (fieldId) => buildDateTable(fieldId),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateDateDefaultValueSpec.create(fieldId, undefined, DATE_DEFAULT_NOW),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousDefaultValue()).toBeUndefined();
      expect(spec.nextDefaultValue()).toBe(DATE_DEFAULT_NOW);
    },
    assertUpdatedField: (field) => {
      expect(field.defaultValue()?.equals(DATE_DEFAULT_NOW)).toBe(true);
    },
    expectedVisit: 'visitUpdateDateDefaultValue',
  },
  {
    name: 'UpdateSingleSelectDefaultValueSpec',
    buildTable: (fieldId) => buildSingleSelectTable(fieldId),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateSingleSelectDefaultValueSpec.create(
        fieldId,
        undefined,
        SELECT_DEFAULT_TODO
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousDefaultValue()).toBeUndefined();
      expect(spec.nextDefaultValue()).toBe(SELECT_DEFAULT_TODO);
    },
    assertUpdatedField: (field) => {
      expect(field.defaultValue()?.equals(SELECT_DEFAULT_TODO)).toBe(true);
    },
    expectedVisit: 'visitUpdateSingleSelectDefaultValue',
  },
  {
    name: 'UpdateSingleSelectAutoNewOptionsSpec',
    buildTable: (fieldId) =>
      buildSingleSelectTable(fieldId, { preventAutoNewOptions: SELECT_ALLOW_AUTO }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateSingleSelectAutoNewOptionsSpec.create(
        fieldId,
        SELECT_ALLOW_AUTO,
        SELECT_PREVENT_AUTO
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousAutoNewOptions()).toBe(SELECT_ALLOW_AUTO);
      expect(spec.nextAutoNewOptions()).toBe(SELECT_PREVENT_AUTO);
    },
    assertUpdatedField: (field) => {
      expect(field.preventAutoNewOptions().equals(SELECT_PREVENT_AUTO)).toBe(true);
    },
    expectedVisit: 'visitUpdateSingleSelectAutoNewOptions',
  },
  {
    name: 'UpdateMultipleSelectDefaultValueSpec',
    buildTable: (fieldId) => buildMultipleSelectTable(fieldId),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateMultipleSelectDefaultValueSpec.create(
        fieldId,
        undefined,
        SELECT_DEFAULT_MULTI
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousDefaultValue()).toBeUndefined();
      expect(spec.nextDefaultValue()).toBe(SELECT_DEFAULT_MULTI);
    },
    assertUpdatedField: (field) => {
      expect(field.defaultValue()?.equals(SELECT_DEFAULT_MULTI)).toBe(true);
    },
    expectedVisit: 'visitUpdateMultipleSelectDefaultValue',
  },
  {
    name: 'UpdateMultipleSelectAutoNewOptionsSpec',
    buildTable: (fieldId) =>
      buildMultipleSelectTable(fieldId, { preventAutoNewOptions: SELECT_ALLOW_AUTO }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateMultipleSelectAutoNewOptionsSpec.create(
        fieldId,
        SELECT_ALLOW_AUTO,
        SELECT_PREVENT_AUTO
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousAutoNewOptions()).toBe(SELECT_ALLOW_AUTO);
      expect(spec.nextAutoNewOptions()).toBe(SELECT_PREVENT_AUTO);
    },
    assertUpdatedField: (field) => {
      expect(field.preventAutoNewOptions().equals(SELECT_PREVENT_AUTO)).toBe(true);
    },
    expectedVisit: 'visitUpdateMultipleSelectAutoNewOptions',
  },
  {
    name: 'UpdateUserMultiplicitySpec',
    buildTable: (fieldId) => buildUserTable(fieldId, { multiplicity: USER_SINGLE }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateUserMultiplicitySpec.create(
        fieldId,
        USER_DB_FIELD_NAME,
        USER_SINGLE,
        USER_MULTIPLE
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.dbFieldName()).toBe(USER_DB_FIELD_NAME);
      expect(spec.previousMultiplicity()).toBe(USER_SINGLE);
      expect(spec.nextMultiplicity()).toBe(USER_MULTIPLE);
      expect(spec.isMultipleToSingle()).toBe(false);
      expect(spec.isSingleToMultiple()).toBe(true);
    },
    assertUpdatedField: (field) => {
      expect(field.multiplicity().equals(USER_MULTIPLE)).toBe(true);
    },
    expectedVisit: 'visitUpdateUserMultiplicity',
  },
  {
    name: 'UpdateUserNotificationSpec',
    buildTable: (fieldId) => buildUserTable(fieldId, { notification: USER_NOTIFY_ON }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateUserNotificationSpec.create(fieldId, USER_NOTIFY_ON, USER_NOTIFY_OFF),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousNotification()).toBe(USER_NOTIFY_ON);
      expect(spec.nextNotification()).toBe(USER_NOTIFY_OFF);
    },
    assertUpdatedField: (field) => {
      expect(field.notification().equals(USER_NOTIFY_OFF)).toBe(true);
    },
    expectedVisit: 'visitUpdateUserNotification',
  },
  {
    name: 'UpdateUserDefaultValueSpec',
    buildTable: (fieldId) =>
      buildUserTable(fieldId, { multiplicity: USER_MULTIPLE, defaultValue: USER_DEFAULT_ME }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateUserDefaultValueSpec.create(
        fieldId,
        USER_DEFAULT_ME,
        USER_DEFAULT_MULTI
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousDefaultValue()).toBe(USER_DEFAULT_ME);
      expect(spec.nextDefaultValue()).toBe(USER_DEFAULT_MULTI);
    },
    assertUpdatedField: (field) => {
      expect(field.defaultValue()?.equals(USER_DEFAULT_MULTI)).toBe(true);
    },
    expectedVisit: 'visitUpdateUserDefaultValue',
  },
  {
    name: 'UpdateButtonLabelSpec',
    buildTable: (fieldId) => buildButtonTable(fieldId, { label: BUTTON_LABEL_RUN }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateButtonLabelSpec.create(fieldId, BUTTON_LABEL_RUN, BUTTON_LABEL_SHIP),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousLabel()).toBe(BUTTON_LABEL_RUN);
      expect(spec.nextLabel()).toBe(BUTTON_LABEL_SHIP);
    },
    assertUpdatedField: (field) => {
      expect(field.label().equals(BUTTON_LABEL_SHIP)).toBe(true);
    },
    expectedVisit: 'visitUpdateButtonLabel',
  },
  {
    name: 'UpdateButtonColorSpec',
    buildTable: (fieldId) => buildButtonTable(fieldId, { color: BUTTON_COLOR_TEAL }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateButtonColorSpec.create(fieldId, BUTTON_COLOR_TEAL, BUTTON_COLOR_BLUE),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousColor()).toBe(BUTTON_COLOR_TEAL);
      expect(spec.nextColor()).toBe(BUTTON_COLOR_BLUE);
    },
    assertUpdatedField: (field) => {
      expect(field.color().equals(BUTTON_COLOR_BLUE)).toBe(true);
    },
    expectedVisit: 'visitUpdateButtonColor',
  },
  {
    name: 'UpdateButtonMaxCountSpec',
    buildTable: (fieldId) => buildButtonTable(fieldId),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateButtonMaxCountSpec.create(fieldId, undefined, BUTTON_MAX_THREE),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousMaxCount()).toBeUndefined();
      expect(spec.nextMaxCount()).toBe(BUTTON_MAX_THREE);
    },
    assertUpdatedField: (field) => {
      expect(field.maxCount()?.equals(BUTTON_MAX_THREE)).toBe(true);
    },
    expectedVisit: 'visitUpdateButtonMaxCount',
  },
  {
    name: 'UpdateButtonWorkflowSpec',
    buildTable: (fieldId) => buildButtonTable(fieldId),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateButtonWorkflowSpec.create(fieldId, undefined, BUTTON_WORKFLOW),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousWorkflow()).toBeUndefined();
      expect(spec.nextWorkflow()).toBe(BUTTON_WORKFLOW);
    },
    assertUpdatedField: (field) => {
      expect(field.workflow()?.equals(BUTTON_WORKFLOW)).toBe(true);
    },
    expectedVisit: 'visitUpdateButtonWorkflow',
  },
  {
    name: 'UpdateRatingMaxSpec',
    buildTable: (fieldId) => buildRatingTable(fieldId, { max: RATING_MAX_FIVE }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateRatingMaxSpec.create(
        fieldId,
        RATING_DB_FIELD_NAME,
        RATING_MAX_FIVE,
        RATING_MAX_THREE
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.dbFieldName()).toBe(RATING_DB_FIELD_NAME);
      expect(spec.previousMax()).toBe(RATING_MAX_FIVE);
      expect(spec.nextMax()).toBe(RATING_MAX_THREE);
      expect(spec.isMaxReducing()).toBe(true);
    },
    assertUpdatedField: (field) => {
      expect(field.ratingMax().equals(RATING_MAX_THREE)).toBe(true);
    },
    expectedVisit: 'visitUpdateRatingMax',
  },
  {
    name: 'UpdateRatingIconSpec',
    buildTable: (fieldId) => buildRatingTable(fieldId, { icon: RATING_ICON_STAR }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateRatingIconSpec.create(fieldId, RATING_ICON_STAR, RATING_ICON_HEART),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousIcon()).toBe(RATING_ICON_STAR);
      expect(spec.nextIcon()).toBe(RATING_ICON_HEART);
    },
    assertUpdatedField: (field) => {
      expect(field.ratingIcon().equals(RATING_ICON_HEART)).toBe(true);
    },
    expectedVisit: 'visitUpdateRatingIcon',
  },
  {
    name: 'UpdateRatingColorSpec',
    buildTable: (fieldId) => buildRatingTable(fieldId, { color: RATING_COLOR_YELLOW }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateRatingColorSpec.create(fieldId, RATING_COLOR_YELLOW, RATING_COLOR_RED),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousColor()).toBe(RATING_COLOR_YELLOW);
      expect(spec.nextColor()).toBe(RATING_COLOR_RED);
    },
    assertUpdatedField: (field) => {
      expect(field.ratingColor().equals(RATING_COLOR_RED)).toBe(true);
    },
    expectedVisit: 'visitUpdateRatingColor',
  },
];

const formulaCases: FormulaCase[] = [
  {
    name: 'UpdateFormulaFormattingSpec',
    buildTable: (fieldId) =>
      buildFormulaTable(fieldId, {
        formatting: FORMULA_FORMATTING_DEFAULT,
        timeZone: TIME_ZONE_UTC,
      }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    buildMissingResultTypeTable: (fieldId) =>
      buildFormulaTableWithMissingResultType(fieldId, {
        formatting: FORMULA_FORMATTING_DEFAULT,
        timeZone: TIME_ZONE_UTC,
      }),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateFormulaFormattingSpec.create(
        fieldId,
        FORMULA_FORMATTING_DEFAULT,
        FORMULA_FORMATTING_CURRENCY
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousFormatting()).toBe(FORMULA_FORMATTING_DEFAULT);
      expect(spec.nextFormatting()).toBe(FORMULA_FORMATTING_CURRENCY);
    },
    assertUpdatedField: (field) => {
      expect(field.formatting()?.equals(FORMULA_FORMATTING_CURRENCY)).toBe(true);
    },
    expectedVisit: 'visitUpdateFormulaFormatting',
  },
  {
    name: 'UpdateFormulaShowAsSpec',
    buildTable: (fieldId) =>
      buildFormulaTable(fieldId, {
        showAs: NUMBER_SHOW_AS_BAR,
        timeZone: TIME_ZONE_UTC,
      }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    buildMissingResultTypeTable: (fieldId) =>
      buildFormulaTableWithMissingResultType(fieldId, {
        showAs: NUMBER_SHOW_AS_BAR,
        timeZone: TIME_ZONE_UTC,
      }),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateFormulaShowAsSpec.create(
        fieldId,
        NUMBER_SHOW_AS_BAR,
        NUMBER_SHOW_AS_RING
      ),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousShowAs()).toBe(NUMBER_SHOW_AS_BAR);
      expect(spec.nextShowAs()).toBe(NUMBER_SHOW_AS_RING);
    },
    assertUpdatedField: (field) => {
      expect(field.showAs()?.equals(NUMBER_SHOW_AS_RING)).toBe(true);
    },
    expectedVisit: 'visitUpdateFormulaShowAs',
  },
  {
    name: 'UpdateFormulaTimeZoneSpec',
    buildTable: (fieldId) =>
      buildFormulaTable(fieldId, {
        timeZone: TIME_ZONE_UTC,
      }),
    buildWrongTypeTable: (fieldId) => buildPlainTextTable(fieldId),
    buildMissingResultTypeTable: (fieldId) =>
      buildFormulaTableWithMissingResultType(fieldId, {
        timeZone: TIME_ZONE_UTC,
      }),
    makeSpec: (fieldId) =>
      FieldUpdateSpecs.UpdateFormulaTimeZoneSpec.create(fieldId, TIME_ZONE_UTC, TIME_ZONE_SHANGHAI),
    assertSpec: (spec, fieldId) => {
      expect(spec.fieldId().equals(fieldId)).toBe(true);
      expect(spec.previousTimeZone()).toBe(TIME_ZONE_UTC);
      expect(spec.nextTimeZone()).toBe(TIME_ZONE_SHANGHAI);
    },
    assertUpdatedField: (field) => {
      expect(field.timeZone()?.equals(TIME_ZONE_SHANGHAI)).toBe(true);
    },
    expectedVisit: 'visitUpdateFormulaTimeZone',
  },
];

describe('Field update value specs', () => {
  it.each(commonCases)(
    'mutates and accepts $name',
    ({ buildTable, makeSpec, assertSpec, assertUpdatedField, expectedVisit }) => {
      const fieldId = createFieldId('x');
      const spec = makeSpec(fieldId);
      const { calls, visitor } = createSpyVisitor();

      assertSpec(spec, fieldId);
      spec.accept(visitor as any)._unsafeUnwrap();
      expect(calls).toContain(expectedVisit);

      const updatedTable = spec.mutate(buildTable(fieldId))._unsafeUnwrap();
      const updatedField = updatedTable
        .getField((field: { id: () => FieldId }) => field.id().equals(fieldId))
        ._unsafeUnwrap();
      assertUpdatedField(updatedField);
    }
  );

  it.each(commonCases)(
    'returns an error when $name targets the wrong field type',
    ({ buildWrongTypeTable, makeSpec }) => {
      const fieldId = createFieldId('y');
      const spec = makeSpec(fieldId);

      expect(spec.mutate(buildWrongTypeTable(fieldId)).isErr()).toBe(true);
    }
  );

  it.each(formulaCases)(
    'mutates and accepts $name',
    ({ buildTable, makeSpec, assertSpec, assertUpdatedField, expectedVisit }) => {
      const fieldId = createFieldId('z');
      const spec = makeSpec(fieldId);
      const { calls, visitor } = createSpyVisitor();

      assertSpec(spec, fieldId);
      spec.accept(visitor as any)._unsafeUnwrap();
      expect(calls).toContain(expectedVisit);

      const updatedTable = spec.mutate(buildTable(fieldId))._unsafeUnwrap();
      const updatedField = updatedTable
        .getField((field: { id: () => FieldId }) => field.id().equals(fieldId))
        ._unsafeUnwrap();
      assertUpdatedField(updatedField);
    }
  );

  it.each(formulaCases)(
    'returns an error when $name is applied before the formula result type is set',
    ({ buildMissingResultTypeTable, makeSpec }) => {
      const fieldId = createFieldId('w');
      const spec = makeSpec(fieldId);
      const result = spec.mutate(buildMissingResultTypeTable(fieldId));

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('result type not set');
    }
  );

  it.each(formulaCases)(
    'returns an error when $name targets the wrong field type',
    ({ buildWrongTypeTable, makeSpec }) => {
      const fieldId = createFieldId('v');
      const spec = makeSpec(fieldId);

      expect(spec.mutate(buildWrongTypeTable(fieldId)).isErr()).toBe(true);
    }
  );
});
