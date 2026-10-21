/**
 * F19 / D16 — autoNumber property updates.
 *
 * Requirement IDs: F19 (system generated serial), D16 (no writable default).
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { DateFormattingPreset, TimeFormatting } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('[D01][S01] F19: autoNumber property updates', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let fieldSeq = 0;

  const nextFieldId = () => {
    fieldSeq += 1;
    return `fld${fieldSeq.toString(36).padStart(16, '0')}`;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'autoNumber Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('updates the field name and keeps the allocated serials', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'autoNumber', id: fieldId, name: 'No' },
    });
    const first = await ctx.createRecord(tableId, {});
    const second = await ctx.createRecord(tableId, {});

    const updated = await ctx.updateField({
      baseId: ctx.baseId as never,
      tableId,
      fieldId,
      field: { name: 'Serial' },
    } as never);
    expect(fieldByName(updated, 'Serial').type).toBe('autoNumber');

    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    expect(findRow(rows, first.id)?.fields[fieldId]).toBe(1);
    expect(findRow(rows, second.id)?.fields[fieldId]).toBe(2);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [first.id, second.id]);
  });

  test('ignores formatting and default payloads the type does not own', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'autoNumber', id: fieldId, name: 'Serial No Options' },
    });

    await ctx.updateField({
      tableId,
      fieldId,
      field: {
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.None,
            timeZone: 'utc',
          },
          defaultValue: 1000,
        } as never,
      },
    });

    const options = fieldOptions(fieldByName(await ctx.getTableById(tableId), 'Serial No Options'));
    expect(options.formatting).toBeUndefined();
    expect(options.defaultValue).toBeUndefined();

    await ctx.deleteField({ tableId, fieldId });
  });
});
