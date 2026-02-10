import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

describe('type consistency', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;
  const branchCases = [
    { name: 'IfLinkThenText', expression: 'IF(TRUE, {LinkType}, {LongText})', expected: '10' },
    { name: 'IfTextThenLink', expression: 'IF(FALSE, {LongText}, {LinkType})', expected: '10' },
    {
      name: 'IfLookupThenEmptyText',
      expression: 'IF(TRUE, {LookupType}, {SingleLineText})',
      expected: null,
    },
    {
      name: 'IfEmptyTextThenLookup',
      expression: 'IF(FALSE, {LookupType}, {SingleLineText})',
      expected: null,
    },
    { name: 'IfTextThenLookup', expression: 'IF(TRUE, {LongText}, {LookupType})', expected: '10' },
    {
      name: 'IfConditionalLookupThenText',
      expression: 'IF(TRUE, {ConditionalLookupType}, {LongText})',
      expected: null,
    },
    { name: 'IfButtonThenText', expression: 'IF(TRUE, {LongText}, {Button})', expected: '10' },
    { name: 'IfNumberThenText', expression: 'IF(TRUE, {Number}, {LongText})', expected: '10' },
    {
      name: 'IfCheckboxThenText',
      expression: 'IF(TRUE, {Checkbox}, {LongText})',
      expected: 'true',
    },
  ];

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = [
      ...branchCases.map(({ name, expression }) => ({ name, expression })),
      { name: 'SwitchLinkThenText', expression: 'SWITCH("a", "a", {LinkType}, "fallback")' },
    ];
    testTable = await createFormulaTestTable(container, formulaFields);

    const tableName = testTable.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const singleLineText = testTable.fieldsByType.singleLineText
      .dbFieldName()
      ._unsafeUnwrap()
      .value()
      ._unsafeUnwrap();
    await sql`UPDATE ${sql.table(tableName)} SET ${sql.ref(singleLineText)} = ''`.execute(
      testTable.db
    );
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(branchCases)('coerces branch types for $name', async ({ name, expected }) => {
    const context = await buildFormulaSnapshotContext(testTable, name);
    expect(context.result).toBe(expected);
  });

  it('coerces link/text branches in SWITCH', async () => {
    const context = await buildFormulaSnapshotContext(testTable, 'SwitchLinkThenText');
    expect(context.result).toBe('10');
  });
});
