import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { explainOkResponseSchema } from '@teable/v2-contract-http';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 field explain endpoints (e2e)', () => {
  let ctx: SharedTestContext;
  let tableId = '';
  let primaryFieldId = '';
  let formulaFieldId = '';

  const postExplain = async (path: string, payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status !== 200) {
      throw new Error(`Explain request failed (${response.status}): ${await response.text()}`);
    }

    const raw = await response.json();
    const parsed = explainOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse explain response');
    }

    return parsed.data.data;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Field Explain',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;

    primaryFieldId = table.fields.find((field) => field.name === 'Name')?.id ?? '';
    if (!primaryFieldId) {
      throw new Error('Missing primary field id');
    }

    await ctx.createRecord(tableId, {
      [primaryFieldId]: 'Alpha',
    });

    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        name: 'Computed',
        options: {
          expression: `{${primaryFieldId}}`,
        },
      },
    });

    formulaFieldId = updatedTable.fields.find((field) => field.name === 'Computed')?.id ?? '';
    if (!formulaFieldId) {
      throw new Error('Missing formula field id');
    }
  });

  afterAll(async () => {
    if (tableId) {
      await ctx.deleteTable(tableId);
    }
  });

  it('explains create field with schema and backfill SQL', async () => {
    const result = await postExplain('/tables/explainCreateField', {
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        name: 'Preview Formula',
        options: {
          expression: `UPPER({${primaryFieldId}})`,
        },
      },
      analyze: false,
      includeSql: true,
      includeGraph: false,
      includeLocks: false,
    });

    expect(result.command.type).toBe('CreateField');
    expect(result.command.changedFieldNames?.[0]).toBe('Preview Formula');
    expect(result.sqlExplains.some((step) => step.sql.toLowerCase().includes('alter table'))).toBe(
      true
    );
    expect(result.sqlExplains.some((step) => step.explainOnly != null)).toBe(true);
  });

  it('explains update field with captured SQL', async () => {
    const result = await postExplain('/tables/explainUpdateField', {
      tableId,
      fieldId: formulaFieldId,
      field: {
        options: {
          expression: `LOWER({${primaryFieldId}})`,
        },
      },
      analyze: false,
      includeSql: true,
      includeGraph: false,
      includeLocks: false,
    });

    expect(result.command.type).toBe('UpdateField');
    expect(result.command.changedFieldIds).toEqual([formulaFieldId]);
    expect(result.sqlExplains.length).toBeGreaterThan(0);
    expect(
      result.sqlExplains.some((step) => {
        const normalized = step.sql.toLowerCase();
        return normalized.startsWith('update ') || normalized.startsWith('with ');
      })
    ).toBe(true);
  });

  it('explains delete field with drop-column SQL', async () => {
    const result = await postExplain('/tables/explainDeleteField', {
      baseId: ctx.baseId,
      tableId,
      fieldId: formulaFieldId,
      analyze: false,
      includeSql: true,
      includeGraph: false,
      includeLocks: false,
    });

    expect(result.command.type).toBe('DeleteField');
    expect(result.command.changedFieldIds).toEqual([formulaFieldId]);
    expect(result.sqlExplains.some((step) => step.sql.toLowerCase().includes('drop column'))).toBe(
      true
    );
  });

  it('[V1 PARITY] ignores stale references to deleted fields when explaining singleSelect updates', async () => {
    let hostTableId: string | undefined;
    let tempTableId: string | undefined;
    let staleReferenceId: string | undefined;

    try {
      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Field Explain SingleSelect ${randomUUID()}`,
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            name: 'School',
            options: ['School A'],
          },
        ],
        views: [{ type: 'grid' }],
      });
      hostTableId = hostTable.id;

      const singleSelectFieldId = hostTable.fields.find((field) => field.name === 'School')?.id;
      if (!singleSelectFieldId) {
        throw new Error('Missing single select field id');
      }

      const hostWithFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTableId,
        field: {
          type: 'formula',
          name: 'School Copy',
          options: {
            expression: `{${singleSelectFieldId}}`,
          },
        },
      });
      const formulaCopyFieldId = hostWithFormula.fields.find(
        (field) => field.name === 'School Copy'
      )?.id;
      if (!formulaCopyFieldId) {
        throw new Error('Missing formula field id');
      }

      const tempTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Field Explain Deleted Ref ${randomUUID()}`,
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      tempTableId = tempTable.id;

      const deletedFieldId = tempTable.fields.find((field) => field.isPrimary)?.id;
      if (!deletedFieldId) {
        throw new Error('Missing deleted field id');
      }

      await ctx.deleteTable(tempTableId);
      tempTableId = undefined;

      const deletedFieldRow = await ctx.testContainer.db
        .selectFrom('field')
        .select(['id', 'deleted_time'])
        .where('id', '=', deletedFieldId)
        .executeTakeFirst();
      expect(deletedFieldRow?.deleted_time).not.toBeNull();

      staleReferenceId = `ref_${randomUUID()}`;
      await ctx.testContainer.db
        .insertInto('reference')
        .values({
          id: staleReferenceId,
          from_field_id: singleSelectFieldId,
          to_field_id: deletedFieldId,
        })
        .onConflict((oc) => oc.columns(['to_field_id', 'from_field_id']).doNothing())
        .execute();

      const explainResult = await postExplain('/tables/explainUpdateField', {
        tableId: hostTableId,
        fieldId: singleSelectFieldId,
        field: {
          options: {
            choices: [
              { id: 'choSchoolA', name: 'School A', color: 'blueBright' },
              { id: 'choSchoolB', name: 'School B', color: 'greenBright' },
            ],
          },
        },
        analyze: false,
        includeSql: true,
        includeGraph: false,
        includeLocks: false,
      });

      expect(explainResult.command.type).toBe('UpdateField');
      expect(explainResult.command.changedFieldIds).toEqual([singleSelectFieldId]);
      expect(explainResult.sqlExplains.length).toBeGreaterThan(0);

      const updatedTable = await ctx.updateField({
        tableId: hostTableId,
        fieldId: singleSelectFieldId,
        field: {
          options: {
            choices: [
              { id: 'choSchoolA', name: 'School A', color: 'blueBright' },
              { id: 'choSchoolB', name: 'School B', color: 'greenBright' },
            ],
          },
        },
      });

      const updatedField = updatedTable.fields.find((field) => field.id === singleSelectFieldId) as
        | { options?: { choices?: Array<{ name: string }> } }
        | undefined;
      expect(updatedField?.options?.choices?.map((choice) => choice.name)).toEqual([
        'School A',
        'School B',
      ]);

      const formulaAfter = updatedTable.fields.find((field) => field.id === formulaCopyFieldId);
      expect(formulaAfter).toBeTruthy();
    } finally {
      if (staleReferenceId) {
        await ctx.testContainer.db
          .deleteFrom('reference')
          .where('id', '=', staleReferenceId)
          .execute();
      }
      if (hostTableId) {
        await ctx.deleteTable(hostTableId).catch(() => undefined);
      }
      if (tempTableId) {
        await ctx.deleteTable(tempTableId).catch(() => undefined);
      }
    }
  });
});
