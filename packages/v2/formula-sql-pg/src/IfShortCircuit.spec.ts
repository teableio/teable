import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

describe('IF unused-branch error short-circuit (T7122)', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(container, [
      {
        name: 'IfZeroDivisorElse',
        expression: 'IF({Number}<=0, "no baseline", IF((1/{Number})>0.05, "up", "ok"))',
      },
      {
        name: 'IsIfAlwaysError',
        expression: 'IS_ERROR(IF({Number}, ERROR("custom error"), ERROR("custom error")))',
      },
    ]);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('returns the THEN branch when the unused ELSE would divide by zero', async () => {
    const tableName = testTable.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const numberField = testTable.fieldsByType.number;
    if (!numberField) throw new Error('Missing Number field');
    const numberColumn = numberField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    await sql`
      UPDATE ${sql.table(tableName)}
      SET ${sql.ref(numberColumn)} = ${0}
    `.execute(testTable.db);

    await expect(executeFormulaAsText(testTable, 'IfZeroDivisorElse')).resolves.toBe('no baseline');
  });

  it('keeps IS_ERROR true when both IF arms are ERROR()', async () => {
    const tableName = testTable.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const numberField = testTable.fieldsByType.number;
    if (!numberField) throw new Error('Missing Number field');
    const numberColumn = numberField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    await sql`
      UPDATE ${sql.table(tableName)}
      SET ${sql.ref(numberColumn)} = ${1}
    `.execute(testTable.db);

    await expect(executeFormulaAsText(testTable, 'IsIfAlwaysError')).resolves.toBe('true');
  });
});
