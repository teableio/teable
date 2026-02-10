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

describe('if branch normalization', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;
  const cases = [
    { id: 'IfLookupThenEmptyText', expression: 'IF(TRUE, {LookupType}, {SingleLineText})' },
    { id: 'IfEmptyTextThenLookup', expression: 'IF(FALSE, {LookupType}, {SingleLineText})' },
  ];

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = cases.map(({ id, expression }) => ({
      name: id,
      expression,
    }));
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

  it.each(cases)('$id snapshots', async ({ id }) => {
    const context = await buildFormulaSnapshotContext(testTable, id);
    expect({
      id,
      formula: context.formula,
      sql: context.sql,
      inputs: context.inputs,
      result: context.result,
    }).toMatchSnapshot();
  });
});
