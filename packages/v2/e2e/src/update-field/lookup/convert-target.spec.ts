/**
 * Convert-path matrix for changing a lookup's target field type.
 *
 * The host-field matrix (`update-field/{type}/conversion` and
 * `conversion/to-lookup.primitives.spec.ts`) covers primitive A → B and
 * primitive → lookup(of primary text). It does not cover the editor
 * `PUT .../convert` path that keeps type=lookup and retargets lookupFieldId
 * onto a different inner type (T6901).
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

type FieldTypeName = 'singleSelect' | 'number' | 'singleLineText' | 'date';

type TargetCase = {
  name: string;
  from: {
    type: FieldTypeName;
    name: string;
    options?: Record<string, unknown>;
    value: unknown;
  };
  to: {
    type: FieldTypeName;
    name: string;
    options?: Record<string, unknown>;
    value: unknown;
    expectedType: FieldTypeName;
    expectedValue: unknown;
  };
};

const cases: TargetCase[] = [
  {
    name: 'singleSelect → number',
    from: {
      type: 'singleSelect',
      name: 'From Status',
      options: { choices: [{ name: 'todo', color: 'orangeDark1' }] },
      value: 'todo',
    },
    to: {
      type: 'number',
      name: 'To Amount',
      options: { formatting: { type: 'decimal', precision: 0 } },
      value: 222,
      expectedType: 'number',
      expectedValue: [222],
    },
  },
  {
    name: 'number → singleLineText',
    from: {
      type: 'number',
      name: 'From Amount',
      options: { formatting: { type: 'decimal', precision: 0 } },
      value: 111,
    },
    to: {
      type: 'singleLineText',
      name: 'To Label',
      value: 'alpha',
      expectedType: 'singleLineText',
      expectedValue: ['alpha'],
    },
  },
  {
    name: 'date → number',
    from: {
      type: 'date',
      name: 'From Date',
      options: { formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'utc' } },
      value: '2026-01-15T00:00:00.000Z',
    },
    to: {
      type: 'number',
      name: 'To Count',
      options: { formatting: { type: 'decimal', precision: 0 } },
      value: 7,
      expectedType: 'number',
      expectedValue: [7],
    },
  },
];

describe('convert-field: lookup target inner-type matrix', () => {
  let ctx: SharedTestContext;
  let sourceTableId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const sourceTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Lookup Convert Source',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    sourceTableId = sourceTable.id;

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Lookup Convert Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    foreignTableId = foreignTable.id;
    const foreignPrimary = foreignTable.fields.find((field) => field.isPrimary);
    if (!foreignPrimary) throw new Error('No foreign primary field');
    foreignPrimaryFieldId = foreignPrimary.id;
  });

  afterAll(async () => {
    if (sourceTableId) await ctx.deleteTable(sourceTableId).catch(() => undefined);
    if (foreignTableId) await ctx.deleteTable(foreignTableId).catch(() => undefined);
  });

  for (const targetCase of cases) {
    test(`T6901 convert ${targetCase.name}`, async () => {
      const foreignWithFrom = await ctx.createField({
        baseId: ctx.baseId,
        tableId: foreignTableId,
        field: {
          type: targetCase.from.type,
          name: targetCase.from.name,
          ...(targetCase.from.options ? { options: targetCase.from.options } : {}),
        },
      });
      const fromField = foreignWithFrom.fields.find((field) => field.name === targetCase.from.name);
      if (!fromField) throw new Error(`${targetCase.from.name} missing`);

      const foreignWithTo = await ctx.createField({
        baseId: ctx.baseId,
        tableId: foreignTableId,
        field: {
          type: targetCase.to.type,
          name: targetCase.to.name,
          ...(targetCase.to.options ? { options: targetCase.to.options } : {}),
        },
      });
      const toField = foreignWithTo.fields.find((field) => field.name === targetCase.to.name);
      if (!toField) throw new Error(`${targetCase.to.name} missing`);

      const sourceWithLink = await ctx.createField({
        baseId: ctx.baseId,
        tableId: sourceTableId,
        field: {
          type: 'link',
          name: `Link ${targetCase.name}`,
          options: {
            foreignTableId,
            relationship: 'manyMany',
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: true,
          },
        },
      });
      const linkField = sourceWithLink.fields.find(
        (field) => field.name === `Link ${targetCase.name}`
      );
      if (!linkField) throw new Error('Link field missing');

      const sourceWithLookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: sourceTableId,
        field: {
          type: 'lookup',
          name: `Lookup ${targetCase.name}`,
          options: {
            linkFieldId: linkField.id,
            foreignTableId,
            lookupFieldId: fromField.id,
          },
        },
      });
      const lookupField = sourceWithLookup.fields.find(
        (field) => field.name === `Lookup ${targetCase.name}`
      );
      if (!lookupField) throw new Error('Lookup field missing');
      expect(lookupField.type).toBe(targetCase.from.type);

      const foreignRecord = await ctx.createRecord(foreignTableId, {
        [foreignPrimaryFieldId]: targetCase.name,
        [fromField.id]: targetCase.from.value,
        [toField.id]: targetCase.to.value,
      });
      const sourceRecord = await ctx.createRecord(sourceTableId, {
        [linkField.id]: [{ id: foreignRecord.id }],
      });

      const updatedTable = await ctx.updateField({
        tableId: sourceTableId,
        fieldId: lookupField.id,
        field: {
          type: 'lookup',
          updateMode: 'full',
          options: {
            linkFieldId: linkField.id,
            foreignTableId,
            lookupFieldId: toField.id,
          },
          ...(targetCase.to.options ? { innerOptions: targetCase.to.options } : {}),
        },
      });
      await ctx.drainOutbox();

      const updatedField = updatedTable.fields.find((field) => field.id === lookupField.id);
      expect(updatedField?.lookupOptions?.lookupFieldId).toBe(toField.id);
      expect(updatedField?.type).toBe(targetCase.to.expectedType);

      const persisted = await sql<{ type: string; cell_value_type: string }>`
        SELECT "type", "cell_value_type"
        FROM "field"
        WHERE "id" = ${lookupField.id}
      `.execute(ctx.testContainer.db);
      expect(persisted.rows[0]?.type).toBe(targetCase.to.expectedType);

      const records = await ctx.listRecords(sourceTableId);
      expect(
        records.find((record) => record.id === sourceRecord.id)?.fields[lookupField.id]
      ).toEqual(targetCase.to.expectedValue);

      await ctx.deleteField({ tableId: sourceTableId, fieldId: lookupField.id });
      await ctx.deleteField({ tableId: sourceTableId, fieldId: linkField.id });
      await ctx.deleteField({ tableId: foreignTableId, fieldId: fromField.id });
      await ctx.deleteField({ tableId: foreignTableId, fieldId: toField.id });
    });
  }
});
