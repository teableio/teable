/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

describe('create-field: formula v1 parity', () => {
  let ctx: SharedTestContext;
  let nameCounter = 0;

  const nextName = (prefix: string) => `${prefix}-${nameCounter++}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('formula update keeps default timezone when showAs is removed', async () => {
    let tableId: string | undefined;

    try {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: nextName('v2-create-reg-formula-timezone'),
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });
      tableId = table.id;

      const tableWithFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: 'F',
          options: {
            expression: '"text"',
            showAs: { type: 'email' },
          },
        },
      });
      const formulaField = tableWithFormula.fields.find((f) => f.name === 'F');
      if (!formulaField) throw new Error('Missing formula field');

      const updated = await ctx.updateField({
        tableId,
        fieldId: formulaField.id,
        field: {
          type: 'formula',
          options: {
            expression: '"text"',
            showAs: null,
          },
        },
      });

      const updatedField = updated.fields.find((f) => f.id === formulaField.id);
      const options = updatedField?.options as {
        expression?: string;
        showAs?: unknown;
        timeZone?: string;
      };

      expect(options.expression).toBe('"text"');
      expect(options.showAs).toBeUndefined();
      expect(options.timeZone?.toLowerCase()).toBe(
        Intl.DateTimeFormat().resolvedOptions().timeZone.toLowerCase()
      );
    } finally {
      if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });
});
