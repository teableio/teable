/**
 * F17 / D16 — createdBy property updates.
 *
 * Requirement IDs: F17 (system generated), D16 (no writable default).
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { DateFormattingPreset, TimeFormatting } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

describe('[D01][S01] F17: createdBy property updates', () => {
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
      name: 'createdBy Update Test',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  test('updates the field name and keeps the stamped actor', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'createdBy', id: fieldId, name: 'Creator' },
    });
    const record = await ctx.createRecord(tableId, {});

    const updated = await ctx.updateField({
      tableId,
      fieldId,
      field: { name: 'Created By Updated' },
    });
    expect(fieldByName(updated, 'Created By Updated').type).toBe('createdBy');

    await expect(readValue(ctx, tableId, record.id, fieldId)).resolves.toMatchObject({
      id: 'usrTestUserId',
    });

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [record.id]);
  });

  test('ignores option payloads the type does not own', async () => {
    const fieldId = nextFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { type: 'createdBy', id: fieldId, name: 'Creator No Options' },
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
          defaultValue: 'usrOther',
        } as never,
      },
    });

    const options = fieldOptions(
      fieldByName(await ctx.getTableById(tableId), 'Creator No Options')
    );
    expect(options.formatting).toBeUndefined();
    expect(options.defaultValue).toBeUndefined();

    await ctx.deleteField({ tableId, fieldId });
  });
});
