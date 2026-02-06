import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { CellValueMultiplicity } from './CellValueMultiplicity';
import { CellValueType } from './CellValueType';
import { DateTimeFormatting } from './DateTimeFormatting';
import { FormulaExpression } from './FormulaExpression';
import { FormulaField } from './FormulaField';
import { FormulaMeta } from './FormulaMeta';
import { NumberFormatting } from './NumberFormatting';
import { MultiNumberDisplayType, NumberShowAs, SingleNumberDisplayType } from './NumberShowAs';
import { SingleLineTextShowAs } from './SingleLineTextShowAs';
import { TimeZone } from './TimeZone';

const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`);

const buildFormulaField = (
  seed: string,
  overrides?: Partial<Parameters<typeof FormulaField.create>[0]>
) => {
  const idResult = createFieldId(seed);
  const nameResult = FieldName.create(`Formula ${seed}`);
  const expressionResult = FormulaExpression.create('1');

  [idResult, nameResult, expressionResult].forEach((r) => r._unsafeUnwrap());
  idResult._unsafeUnwrap();
  nameResult._unsafeUnwrap();
  expressionResult._unsafeUnwrap();

  return FormulaField.create({
    id: idResult._unsafeUnwrap(),
    name: nameResult._unsafeUnwrap(),
    expression: expressionResult._unsafeUnwrap(),
    timeZone: TimeZone.default(),
    ...overrides,
  });
};

describe('FormulaField', () => {
  it('creates formula fields and manages result types', () => {
    const fieldResult = buildFormulaField('a');
    fieldResult?._unsafeUnwrap();

    const field = fieldResult._unsafeUnwrap();

    expect(field.computed().toBoolean()).toBe(true);
    field.cellValueType()._unsafeUnwrapErr();
    field.isMultipleCellValue()._unsafeUnwrapErr();

    const setResult = field.setResultType(CellValueType.number(), CellValueMultiplicity.single());
    setResult._unsafeUnwrap();
    field.cellValueType()._unsafeUnwrap();
    field.isMultipleCellValue()._unsafeUnwrap();

    const sameResult = field.setResultType(CellValueType.number(), CellValueMultiplicity.single());
    sameResult._unsafeUnwrap();

    const typeMismatch = field.setResultType(
      CellValueType.string(),
      CellValueMultiplicity.single()
    );
    typeMismatch._unsafeUnwrapErr();

    const multiplicityMismatch = field.setResultType(
      CellValueType.number(),
      CellValueMultiplicity.multiple()
    );
    multiplicityMismatch._unsafeUnwrapErr();

    const sameExpression = field.setExpression(field.expression());
    sameExpression._unsafeUnwrap();
    const newExpression = FormulaExpression.create('2 + 2');
    newExpression._unsafeUnwrap();

    const updateExpression = field.setExpression(newExpression._unsafeUnwrap());
    updateExpression._unsafeUnwrap();
  });

  it('applies and validates formatting', () => {
    const unsetResult = buildFormulaField('b');
    unsetResult?._unsafeUnwrap();

    const unsetField = unsetResult._unsafeUnwrap();
    const unsetFormatting = unsetField.setFormatting(NumberFormatting.default());
    unsetFormatting._unsafeUnwrapErr();

    const fieldResult = buildFormulaField('c');
    fieldResult?._unsafeUnwrap();

    const field = fieldResult._unsafeUnwrap();
    field.setResultType(CellValueType.number(), CellValueMultiplicity.single())._unsafeUnwrap();

    const setFormatting = field.setFormatting(NumberFormatting.default());
    setFormatting._unsafeUnwrap();
    const setFormattingAgain = field.setFormatting(NumberFormatting.default());
    setFormattingAgain._unsafeUnwrapErr();

    const invalidFormattingField = buildFormulaField('d');
    invalidFormattingField?._unsafeUnwrap();

    const invalidField = invalidFormattingField._unsafeUnwrap();
    invalidField
      .setResultType(CellValueType.number(), CellValueMultiplicity.single())
      ._unsafeUnwrap();
    const invalidFormatting = invalidField.setFormatting(DateTimeFormatting.default());
    invalidFormatting._unsafeUnwrapErr();
  });

  it('validates showAs and cell type combinations', () => {
    const singleShowAs = NumberShowAs.create({
      type: SingleNumberDisplayType.Bar,
      color: 'blue',
      showValue: true,
      maxValue: 100,
    });
    const multiShowAs = NumberShowAs.create({
      type: MultiNumberDisplayType.Bar,
      color: 'blue',
    });
    const textShowAs = SingleLineTextShowAs.create({ type: 'email' });
    const singleShowAsValue = singleShowAs._unsafeUnwrap();
    const multiShowAsValue = multiShowAs._unsafeUnwrap();
    const textShowAsValue = textShowAs._unsafeUnwrap();

    const singleShowAsField = buildFormulaField('e', { showAs: singleShowAsValue });
    const singleShowAsValueField = singleShowAsField._unsafeUnwrap();

    const singleResult = singleShowAsValueField.setResultType(
      CellValueType.number(),
      CellValueMultiplicity.multiple()
    );
    singleResult._unsafeUnwrapErr();

    const multiShowAsField = buildFormulaField('f', { showAs: multiShowAsValue });
    const multiShowAsValueField = multiShowAsField._unsafeUnwrap();

    const multiResult = multiShowAsValueField.setResultType(
      CellValueType.number(),
      CellValueMultiplicity.single()
    );
    multiResult._unsafeUnwrapErr();

    const okShowAsField = buildFormulaField('g', { showAs: multiShowAsValue });
    const okShowAsValueField = okShowAsField._unsafeUnwrap();

    const okResult = okShowAsValueField.setResultType(
      CellValueType.number(),
      CellValueMultiplicity.multiple()
    );
    okResult._unsafeUnwrap();

    const stringWithNumberShowAs = buildFormulaField('h', { showAs: multiShowAsValue });
    const stringWithNumberShowAsField = stringWithNumberShowAs._unsafeUnwrap();

    const stringShowAsError = stringWithNumberShowAsField.setResultType(
      CellValueType.string(),
      CellValueMultiplicity.single()
    );
    stringShowAsError._unsafeUnwrapErr();

    const stringWithTextShowAs = buildFormulaField('i', { showAs: textShowAsValue });
    const stringWithTextShowAsField = stringWithTextShowAs._unsafeUnwrap();

    const stringShowAsOk = stringWithTextShowAsField.setResultType(
      CellValueType.string(),
      CellValueMultiplicity.single()
    );
    stringShowAsOk._unsafeUnwrap();

    const dateTimeWithFormatting = buildFormulaField('j', {
      formatting: DateTimeFormatting.default(),
    });
    const dateTimeWithFormattingField = dateTimeWithFormatting._unsafeUnwrap();

    const dateTimeOk = dateTimeWithFormattingField.setResultType(
      CellValueType.dateTime(),
      CellValueMultiplicity.single()
    );
    dateTimeOk._unsafeUnwrap();

    const dateTimeWithShowAs = buildFormulaField('k', { showAs: textShowAsValue });
    const dateTimeWithShowAsField = dateTimeWithShowAs._unsafeUnwrap();

    const dateTimeShowAsError = dateTimeWithShowAsField.setResultType(
      CellValueType.dateTime(),
      CellValueMultiplicity.single()
    );
    dateTimeShowAsError._unsafeUnwrapErr();

    const booleanWithFormatting = buildFormulaField('l', {
      formatting: NumberFormatting.default(),
    });
    const booleanWithFormattingField = booleanWithFormatting._unsafeUnwrap();

    const booleanFormattingError = booleanWithFormattingField.setResultType(
      CellValueType.boolean(),
      CellValueMultiplicity.single()
    );
    booleanFormattingError._unsafeUnwrapErr();

    const booleanOk = buildFormulaField('m');
    const booleanOkField = booleanOk._unsafeUnwrap();

    const booleanResult = booleanOkField.setResultType(
      CellValueType.boolean(),
      CellValueMultiplicity.single()
    );
    booleanResult._unsafeUnwrap();
  });

  it('provides defaults and meta behavior', () => {
    const numberFormatting = FormulaField.defaultFormatting(CellValueType.number());
    expect(numberFormatting).toBeInstanceOf(NumberFormatting);
    const dateFormatting = FormulaField.defaultFormatting(CellValueType.dateTime());
    expect(dateFormatting).toBeInstanceOf(DateTimeFormatting);
    expect(FormulaField.defaultFormatting(CellValueType.string())).toBeUndefined();

    const numberDefaults = FormulaField.defaultOptions(CellValueType.number());
    expect(numberDefaults.formatting).toBeInstanceOf(NumberFormatting);
    expect(numberDefaults.expression.toString()).toBe('');
    const stringDefaults = FormulaField.defaultOptions(CellValueType.string());
    expect(stringDefaults.formatting).toBeUndefined();

    const metaResult = FormulaMeta.rehydrate({ persistedAsGeneratedColumn: true });
    metaResult._unsafeUnwrap();

    const fieldWithMeta = buildFormulaField('n', { meta: metaResult._unsafeUnwrap() });
    const fieldWithMetaValue = fieldWithMeta._unsafeUnwrap();

    const persisted = fieldWithMetaValue.isPersistedAsGeneratedColumn();
    expect(persisted._unsafeUnwrap()).toBe(true);

    const fieldWithoutMeta = buildFormulaField('o');
    const fieldWithoutMetaValue = fieldWithoutMeta._unsafeUnwrap();

    const notPersisted = fieldWithoutMetaValue.isPersistedAsGeneratedColumn();
    expect(notPersisted._unsafeUnwrap()).toBe(false);
  });
});
