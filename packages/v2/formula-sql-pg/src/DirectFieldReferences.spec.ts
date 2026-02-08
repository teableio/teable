import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildFormulaSnapshotContext,
  createFieldTypeCases,
  createFormulaTestContainer,
  createFormulaTestTable,
  type FormulaFieldDefinition,
  type FormulaTestTable,
} from './testkit/FormulaSqlPgTestkit';

/**
 * Direct Field Reference Tests
 *
 * Tests for formula expressions that directly reference fields without any function wrapping.
 * For example: {linkField}, {numberField}, {textField}, etc.
 *
 * This tests the scenario where a formula simply returns the value of another field.
 * For JSON fields (like link/button), it should extract the display value (title).
 */
describe('direct field references', () => {
  const fieldCases = createFieldTypeCases();
  let container: IV2NodeTestContainer;
  let testTable: FormulaTestTable;

  const buildFormulaName = (fieldName: string): string => `Direct_${fieldName}`;

  beforeAll(async () => {
    container = await createFormulaTestContainer();

    // Create formula fields that directly reference each field type
    const formulaFields: FormulaFieldDefinition[] = fieldCases.map((fieldCase) => ({
      name: buildFormulaName(fieldCase.fieldName),
      expression: `{${fieldCase.fieldName}}`,
    }));

    testTable = await createFormulaTestTable(container, formulaFields);
  });

  afterAll(async () => {
    await container.dispose();
  });

  const matrix = fieldCases.map((fieldCase) => ({
    fieldCase,
    formulaName: buildFormulaName(fieldCase.fieldName),
  }));

  it.each(matrix)(
    'direct reference to $fieldCase.type field',
    async ({ fieldCase, formulaName }) => {
      const context = await buildFormulaSnapshotContext(testTable, formulaName);
      expect({
        fieldType: fieldCase.type,
        formula: context.formula,
        sql: context.sql,
        inputs: context.inputs,
        result: context.result,
      }).toMatchSnapshot();
    }
  );

  describe('link field display value extraction', () => {
    /**
     * When a formula directly references a link field,
     * it should return the title (display value) of the linked record,
     * not the full JSON object with id and title.
     */
    it('should return title for link field, not JSON object', async () => {
      const context = await buildFormulaSnapshotContext(testTable, 'Direct_LinkType');

      // The result should be a string title, not a JSON object
      // If the link has a value, it should be the title string
      if (context.result !== null) {
        // Should not be a JSON object string like {"id": "rec...", "title": "..."}
        expect(context.result).not.toMatch(/^\s*\{.*"id".*"title".*\}\s*$/);
      }
    });
  });
});
