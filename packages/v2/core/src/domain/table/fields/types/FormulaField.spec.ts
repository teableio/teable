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

  expect([idResult, nameResult, expressionResult].every((r) => r.isOk())).toBe(true);
  if (idResult.isErr() || nameResult.isErr() || expressionResult.isErr()) return;

  return FormulaField.create({
    id: idResult.value,
    name: nameResult.value,
    expression: expressionResult.value,
    timeZone: TimeZone.default(),
    ...overrides,
  });
};

describe('FormulaField', () => {
  it('creates formula fields and manages result types', () => {
    const fieldResult = buildFormulaField('a');
    expect(fieldResult?.isOk()).toBe(true);
    if (!fieldResult || fieldResult.isErr()) return;
    const field = fieldResult.value;

    expect(field.cellValueType().isErr()).toBe(true);
    expect(field.isMultipleCellValue().isErr()).toBe(true);

    const setResult = field.setResultType(CellValueType.number(), CellValueMultiplicity.single());
    expect(setResult.isOk()).toBe(true);
    expect(field.cellValueType().isOk()).toBe(true);
    expect(field.isMultipleCellValue().isOk()).toBe(true);

    const sameResult = field.setResultType(CellValueType.number(), CellValueMultiplicity.single());
    expect(sameResult.isOk()).toBe(true);

    const typeMismatch = field.setResultType(
      CellValueType.string(),
      CellValueMultiplicity.single()
    );
    expect(typeMismatch.isErr()).toBe(true);

    const multiplicityMismatch = field.setResultType(
      CellValueType.number(),
      CellValueMultiplicity.multiple()
    );
    expect(multiplicityMismatch.isErr()).toBe(true);

    const sameExpression = field.setExpression(field.expression());
    expect(sameExpression.isOk()).toBe(true);
    const newExpression = FormulaExpression.create('2 + 2');
    expect(newExpression.isOk()).toBe(true);
    if (newExpression.isErr()) return;
    const updateExpression = field.setExpression(newExpression.value);
    expect(updateExpression.isOk()).toBe(true);
  });

  it('applies and validates formatting', () => {
    const unsetResult = buildFormulaField('b');
    expect(unsetResult?.isOk()).toBe(true);
    if (!unsetResult || unsetResult.isErr()) return;
    const unsetField = unsetResult.value;
    const unsetFormatting = unsetField.setFormatting(NumberFormatting.default());
    expect(unsetFormatting.isErr()).toBe(true);

    const fieldResult = buildFormulaField('c');
    expect(fieldResult?.isOk()).toBe(true);
    if (!fieldResult || fieldResult.isErr()) return;
    const field = fieldResult.value;
    expect(field.setResultType(CellValueType.number(), CellValueMultiplicity.single()).isOk()).toBe(
      true
    );

    const setFormatting = field.setFormatting(NumberFormatting.default());
    expect(setFormatting.isOk()).toBe(true);
    const setFormattingAgain = field.setFormatting(NumberFormatting.default());
    expect(setFormattingAgain.isErr()).toBe(true);

    const invalidFormattingField = buildFormulaField('d');
    expect(invalidFormattingField?.isOk()).toBe(true);
    if (!invalidFormattingField || invalidFormattingField.isErr()) return;
    const invalidField = invalidFormattingField.value;
    expect(
      invalidField.setResultType(CellValueType.number(), CellValueMultiplicity.single()).isOk()
    ).toBe(true);
    const invalidFormatting = invalidField.setFormatting(DateTimeFormatting.default());
    expect(invalidFormatting.isErr()).toBe(true);
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
    expect([singleShowAs, multiShowAs, textShowAs].every((r) => r.isOk())).toBe(true);
    if (singleShowAs.isErr() || multiShowAs.isErr() || textShowAs.isErr()) return;

    const singleShowAsField = buildFormulaField('e', { showAs: singleShowAs.value });
    expect(singleShowAsField?.isOk()).toBe(true);
    if (!singleShowAsField || singleShowAsField.isErr()) return;
    const singleResult = singleShowAsField.value.setResultType(
      CellValueType.number(),
      CellValueMultiplicity.multiple()
    );
    expect(singleResult.isErr()).toBe(true);

    const multiShowAsField = buildFormulaField('f', { showAs: multiShowAs.value });
    expect(multiShowAsField?.isOk()).toBe(true);
    if (!multiShowAsField || multiShowAsField.isErr()) return;
    const multiResult = multiShowAsField.value.setResultType(
      CellValueType.number(),
      CellValueMultiplicity.single()
    );
    expect(multiResult.isErr()).toBe(true);

    const okShowAsField = buildFormulaField('g', { showAs: multiShowAs.value });
    expect(okShowAsField?.isOk()).toBe(true);
    if (!okShowAsField || okShowAsField.isErr()) return;
    const okResult = okShowAsField.value.setResultType(
      CellValueType.number(),
      CellValueMultiplicity.multiple()
    );
    expect(okResult.isOk()).toBe(true);

    const stringWithNumberShowAs = buildFormulaField('h', { showAs: multiShowAs.value });
    expect(stringWithNumberShowAs?.isOk()).toBe(true);
    if (!stringWithNumberShowAs || stringWithNumberShowAs.isErr()) return;
    const stringShowAsError = stringWithNumberShowAs.value.setResultType(
      CellValueType.string(),
      CellValueMultiplicity.single()
    );
    expect(stringShowAsError.isErr()).toBe(true);

    const stringWithTextShowAs = buildFormulaField('i', { showAs: textShowAs.value });
    expect(stringWithTextShowAs?.isOk()).toBe(true);
    if (!stringWithTextShowAs || stringWithTextShowAs.isErr()) return;
    const stringShowAsOk = stringWithTextShowAs.value.setResultType(
      CellValueType.string(),
      CellValueMultiplicity.single()
    );
    expect(stringShowAsOk.isOk()).toBe(true);

    const dateTimeWithFormatting = buildFormulaField('j', {
      formatting: DateTimeFormatting.default(),
    });
    expect(dateTimeWithFormatting?.isOk()).toBe(true);
    if (!dateTimeWithFormatting || dateTimeWithFormatting.isErr()) return;
    const dateTimeOk = dateTimeWithFormatting.value.setResultType(
      CellValueType.dateTime(),
      CellValueMultiplicity.single()
    );
    expect(dateTimeOk.isOk()).toBe(true);

    const dateTimeWithShowAs = buildFormulaField('k', { showAs: textShowAs.value });
    expect(dateTimeWithShowAs?.isOk()).toBe(true);
    if (!dateTimeWithShowAs || dateTimeWithShowAs.isErr()) return;
    const dateTimeShowAsError = dateTimeWithShowAs.value.setResultType(
      CellValueType.dateTime(),
      CellValueMultiplicity.single()
    );
    expect(dateTimeShowAsError.isErr()).toBe(true);

    const booleanWithFormatting = buildFormulaField('l', {
      formatting: NumberFormatting.default(),
    });
    expect(booleanWithFormatting?.isOk()).toBe(true);
    if (!booleanWithFormatting || booleanWithFormatting.isErr()) return;
    const booleanFormattingError = booleanWithFormatting.value.setResultType(
      CellValueType.boolean(),
      CellValueMultiplicity.single()
    );
    expect(booleanFormattingError.isErr()).toBe(true);

    const booleanOk = buildFormulaField('m');
    expect(booleanOk?.isOk()).toBe(true);
    if (!booleanOk || booleanOk.isErr()) return;
    const booleanResult = booleanOk.value.setResultType(
      CellValueType.boolean(),
      CellValueMultiplicity.single()
    );
    expect(booleanResult.isOk()).toBe(true);
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
    expect(metaResult.isOk()).toBe(true);
    if (metaResult.isErr()) return;

    const fieldWithMeta = buildFormulaField('n', { meta: metaResult.value });
    expect(fieldWithMeta?.isOk()).toBe(true);
    if (!fieldWithMeta || fieldWithMeta.isErr()) return;
    const persisted = fieldWithMeta.value.isPersistedAsGeneratedColumn();
    expect(persisted.isOk()).toBe(true);
    if (persisted.isErr()) return;
    expect(persisted.value).toBe(true);

    const fieldWithoutMeta = buildFormulaField('o');
    expect(fieldWithoutMeta?.isOk()).toBe(true);
    if (!fieldWithoutMeta || fieldWithoutMeta.isErr()) return;
    const notPersisted = fieldWithoutMeta.value.isPersistedAsGeneratedColumn();
    expect(notPersisted.isOk()).toBe(true);
    if (notPersisted.isErr()) return;
    expect(notPersisted.value).toBe(false);
  });
});
