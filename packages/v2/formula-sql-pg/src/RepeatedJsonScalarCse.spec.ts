import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFormulaTestContainer,
  createFormulaTestTable,
  executeFormulaAsText,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

const countFirstElementExtracts = (sql: string): number => sql.split('-> 0').length - 1;

// T7139: nested IF `{Attachment}=""` must intern `jsonb -> 0` once.

describe('repeated JSON scalar CSE', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    testTable = await createFormulaTestTable(
      container,
      [
        {
          name: 'RepeatedAttachmentEmpty',
          expression:
            'IF({Attachment}="", "missing", IF({Attachment}="", "also missing", "has file"))',
        },
        {
          name: 'SingleAttachmentEmpty',
          expression: 'IF({Attachment}="", "missing", "has file")',
        },
      ],
      { profile: 'minimal', fieldTypes: ['singleLineText', 'attachment'] }
    );
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('evaluates repeated attachment emptiness the same as nested IF', async () => {
    await expect(executeFormulaAsText(testTable, 'RepeatedAttachmentEmpty')).resolves.toBe(
      'has file'
    );
  });

  it('emits the attachment first-element extract once when referenced twice', () => {
    const definition = testTable.formulaDefinitions.get('RepeatedAttachmentEmpty');
    if (!definition) throw new Error('Missing RepeatedAttachmentEmpty');
    const expression = definition.expressionWithIds ?? definition.expression;
    const sqlExpr = testTable.translator.translateExpression(expression)._unsafeUnwrap();
    const sql = testTable.translator.renderSql(sqlExpr);

    expect(countFirstElementExtracts(sql)).toBe(1);
    expect(sql).toContain('FROM (SELECT');
  });
  it('still extracts a single attachment emptiness check once', () => {
    const definition = testTable.formulaDefinitions.get('SingleAttachmentEmpty');
    if (!definition) throw new Error('Missing SingleAttachmentEmpty');
    const expression = definition.expressionWithIds ?? definition.expression;
    const sqlExpr = testTable.translator.translateExpression(expression)._unsafeUnwrap();
    const sql = testTable.translator.renderSql(sqlExpr);

    expect(countFirstElementExtracts(sql)).toBe(1);
  });
});
