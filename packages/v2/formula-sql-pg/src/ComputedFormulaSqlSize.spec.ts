import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  LookupOptions,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';
import {
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const coreExpression = (fieldName: string): string =>
  `SUM(ARRAY_COMPACT(TEXTSPLIT(REGEXP_REPLACE({${fieldName}}, "[^0-9.]+", ":"), ":")))`;

const countOccurrences = (value: string, search: string): number => value.split(search).length - 1;

const renderScalarLookupFormula = (): string => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const hostTableId = TableId.create(`tbl${'h'.repeat(16)}`)._unsafeUnwrap();
  const foreignFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
  const linkFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();

  const foreignBuilder = Table.builder()
    .withId(foreignTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Foreign')._unsafeUnwrap());
  foreignBuilder
    .field()
    .singleLineText()
    .withId(foreignFieldId)
    .withName(FieldName.create('Ratio')._unsafeUnwrap())
    .done();
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyOne',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: foreignFieldId.toString(),
    symmetricFieldId: `fld${'s'.repeat(16)}`,
  })._unsafeUnwrap();
  const lookupOptions = LookupOptions.create({
    linkFieldId: linkFieldId.toString(),
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: foreignFieldId.toString(),
  })._unsafeUnwrap();
  const hostBuilder = Table.builder()
    .withId(hostTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Host')._unsafeUnwrap());
  hostBuilder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Source')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  hostBuilder
    .field()
    .lookup()
    .withId(lookupFieldId)
    .withName(FieldName.create('LookupRatio')._unsafeUnwrap())
    .withLookupOptions(lookupOptions)
    .withInnerField(foreignTable.getFields()[0])
    .withIsMultipleCellValue(false)
    .done();
  hostBuilder.view().defaultGrid().done();
  const hostTable = hostBuilder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
  const lookupField = hostTable
    .getField((field) => field.id().equals(lookupFieldId))
    ._unsafeUnwrap();
  lookupField.setDbFieldName(DbFieldName.rehydrate('lookup_ratio')._unsafeUnwrap())._unsafeUnwrap();

  const translator = new FormulaSqlPgTranslator({
    table: hostTable,
    tableAlias: 't',
    typeValidationStrategy: new Pg16TypeValidationStrategy(),
    resolveFieldSql: (field) =>
      field
        .dbFieldName()
        .andThen((name) => name.value())
        .map((column) =>
          makeExpr(
            `"t"."${column}"`,
            'unknown',
            false,
            undefined,
            undefined,
            field,
            field.id().equals(lookupFieldId) ? 'json' : undefined
          )
        )
        .orElse(() => ok(makeExpr('NULL', 'unknown'))),
  });
  const expression = `${coreExpression(lookupFieldId.toString())} + ${coreExpression(
    lookupFieldId.toString()
  )}`;
  const sqlExpr = translator.translateExpression(expression)._unsafeUnwrap();
  return translator.renderSql(sqlExpr);
};

describe('computed formula SQL size', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(
      container,
      [
        { name: 'CompactSplitSum', expression: coreExpression('SingleLineText') },
        {
          name: 'RepeatedLookup',
          expression: `IF({LookupType}="", 0, ${coreExpression('LookupType')} + ${coreExpression('LookupType')})`,
        },
      ],
      { profile: 'minimal', fieldTypes: ['singleLineText', 'lookup'] }
    );
  });

  afterAll(async () => {
    await container.dispose();
  });

  const render = (formulaName: string): string => {
    const definition = testTable.formulaDefinitions.get(formulaName);
    if (!definition) throw new Error(`Missing formula definition: ${formulaName}`);
    const expression = definition.expressionWithIds ?? definition.expression;
    const sqlExpr = testTable.translator.translateExpression(expression)._unsafeUnwrap();
    return testTable.translator.renderSql(sqlExpr);
  };

  it('keeps nested TEXTSPLIT normalization from duplicating its source expression', async () => {
    const sql = render('CompactSplitSum');

    expect(countOccurrences(sql, "'[^0-9.]+'")).toBeLessThanOrEqual(4);
    expect(sql).not.toContain('pg_typeof(to_jsonb(string_to_array');
    await expect(executeFormulaAsText(testTable, 'CompactSplitSum')).resolves.toBe('10');
  });

  it('interns repeated lookup scalar extraction in production-shaped formulas', () => {
    const sql = render('RepeatedLookup');

    expect(sql).toContain('AS MATERIALIZED');
    expect(countOccurrences(sql, ' -> 0')).toBeLessThanOrEqual(4);
    expect(sql.length).toBeLessThan(40_000);
  });

  it('interns repeated scalar JSON lookup extraction', () => {
    const sql = renderScalarLookupFormula();

    expect(sql).toContain('AS MATERIALIZED');
    expect(countOccurrences(sql, 'lookup_ratio')).toBeLessThanOrEqual(6);
    expect(sql.length).toBeLessThan(10_000);
  });
});
