import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

type ParameterlessFunctionCase = {
  id: string;
  expression: string;
  normalizeResult?: (value: string | null) => string | null;
};

const maskDigits = (value: string | null): string | null => {
  if (!value) return value;
  // Normalize timestamp: replace all digits with 0, but preserve the structure
  // Handle different timestamp precisions by normalizing to a fixed format
  return value
    .replace(/\d/g, '0')
    .replace(/\.0+(\+|-|$)/, '.000000$1')
    .replace(/\.0+(\+|-|$)/, '.000000$1'); // Run twice to catch all variations
};

const parameterlessFunctionCases: ReadonlyArray<ParameterlessFunctionCase> = [
  {
    id: 'ParamlessToday',
    expression: 'TODAY()',
    normalizeResult: maskDigits,
  },
  {
    id: 'ParamlessNow',
    expression: 'NOW()',
    normalizeResult: maskDigits,
  },
  {
    id: 'ParamlessCreatedTime',
    expression: 'CREATED_TIME()',
    normalizeResult: maskDigits,
  },
  {
    id: 'ParamlessLastModifiedTime',
    expression: 'LAST_MODIFIED_TIME()',
    normalizeResult: maskDigits,
  },
  {
    id: 'ParamlessRecordId',
    expression: 'RECORD_ID()',
    // RecordId returns a random ID, so we normalize it
    normalizeResult: (value) => (value ? 'recXXXXXXXXXXXXXXX' : value),
  },
  {
    id: 'ParamlessAutoNumber',
    expression: 'AUTO_NUMBER()',
  },
];

describe('parameterless functions', () => {
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const formulaFields: FormulaFieldDefinition[] = parameterlessFunctionCases.map((fn) => ({
      name: fn.id,
      expression: fn.expression,
    }));
    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  it.each(parameterlessFunctionCases)(
    '$id returns expected SQL and result',
    async ({ id, normalizeResult }) => {
      const context = await buildFormulaSnapshotContext(testTable, id);
      const result = normalizeResult ? normalizeResult(context.result) : context.result;
      expect({
        funcId: id,
        formula: context.formula,
        sql: context.sql,
        result,
      }).toMatchSnapshot();
    }
  );
});
