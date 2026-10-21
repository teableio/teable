/**
 * F01 / F02 / F10 — the text and attachment display contract.
 *
 * F01 (实现依据): a single-line text field defaults to plain text, with email,
 * phone and URL as optional actions; the value is the raw string either way, so
 * a URL-looking value in a plain field is still stored verbatim.
 * F02 (实现依据): plain and Markdown are render modes over one stored source
 * value — switching modes never rewrites the cell.
 * F10 (实现依据): an attachment cell carries file metadata, not bytes, and
 * `totalAttachmentSize` is the size statistic the field type adds.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  AggregateTableRecordsQuery,
  v2CoreTokens,
  type AggregateTableRecordsResult,
  type IQueryBus,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';
import {
  ensureAttachmentTables,
  makeAttachmentCell,
  seedAttachment,
} from '../../update-field/attachment/testUtils';

/**
 * F02 — the long-text render modes. `markdown` is the only configured action:
 * "plain" is the absence of a configuration rather than a value of its own.
 */
const LONG_TEXT_MODES = ['markdown'] as const;

describe('F01/F02/F10: text and attachment display contract', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let queryBus: IQueryBus;
  const actorId = ActorId.create('usrTestUserId')._unsafeUnwrap();
  let seq = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    queryBus = ctx.testContainer.container.resolve(v2CoreTokens.queryBus);
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'F01 Text And Attachment',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const statistic = async (targetTableId: string, fieldId: string, statisticFunc: string) => {
    const query = AggregateTableRecordsQuery.create({
      tableId: targetTableId,
      fields: [{ fieldId, statisticFunc }],
    });
    if (query.isErr()) throw new Error(query.error.message);
    const result = await queryBus.execute<AggregateTableRecordsQuery, AggregateTableRecordsResult>(
      { actorId, windowId: 'e2e-window' },
      query.value
    );
    if (result.isErr()) throw new Error(result.error.message);
    const entry = (
      result.value.values as unknown as Array<{
        fieldId: string;
        statisticFunc: string;
        value: unknown;
      }>
    ).find(
      (candidate) =>
        String(candidate.fieldId) === fieldId && candidate.statisticFunc === statisticFunc
    );
    return entry?.value;
  };

  describe('F01 single line text', () => {
    it('defaults to plain text with no action configured', async () => {
      seq += 1;
      const name = `F01-plain-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleLineText', name },
      });
      expect(fieldOptions(fieldByName(created, name)).showAs ?? null).toBeNull();
    });

    it('stores a URL-looking value verbatim when no action is configured', async () => {
      seq += 1;
      const name = `F01-url-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleLineText', name },
      });
      const fieldId = fieldByName(created, name).id;
      const url = 'https://example.com/path?a=1&b=2#frag';

      const record = await ctx.createRecord(tableId, { [fieldId]: url });
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[fieldId]).toBe(url);
    });

    it('keeps the value when the action is cleared again', async () => {
      seq += 1;
      const name = `F01-clear-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleLineText', name, options: { showAs: { type: 'url' } } },
      });
      const fieldId = fieldByName(created, name).id;
      const record = await ctx.createRecord(tableId, { [fieldId]: 'https://example.com' });

      await ctx.updateField({ tableId, fieldId, field: { options: { showAs: null } } });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[fieldId]).toBe('https://example.com');
      const reloaded = await ctx.getTableById(tableId);
      expect(fieldOptions(reloaded.fields.find((f) => f.id === fieldId)).showAs ?? null).toBeNull();
    });
  });

  describe('F02 long text render modes', () => {
    it.each(LONG_TEXT_MODES)('round-trips the %s mode', async (mode) => {
      seq += 1;
      const name = `F02-${mode}-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', name, options: { showAs: { type: mode } } },
      });
      const reloaded = await ctx.getTableById(tableId);
      expect(
        fieldOptions(reloaded.fields.find((f) => f.id === fieldByName(created, name).id)).showAs
      ).toEqual({ type: mode });
    });

    it('plain text is the absence of a render mode', async () => {
      seq += 1;
      const name = `F02-plain-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', name },
      });
      expect(fieldOptions(fieldByName(created, name)).showAs ?? null).toBeNull();
    });

    it('switching between plain and Markdown keeps one source value', async () => {
      seq += 1;
      const name = `F02-switch-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'longText', name },
      });
      const fieldId = fieldByName(created, name).id;
      // Markdown source with syntax, line breaks and a CJK line.
      const source = '# Heading\n\n- item **bold**\n\n中文段落';
      const record = await ctx.createRecord(tableId, { [fieldId]: source });

      await ctx.updateField({
        tableId,
        fieldId,
        field: { options: { showAs: { type: 'markdown' } } },
      });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[fieldId]).toBe(source);

      // Switching back does not render the Markdown into HTML either.
      await ctx.updateField({
        tableId,
        fieldId,
        field: { options: { showAs: null } },
      });
      const backRows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(backRows, record.id)?.fields[fieldId]).toBe(source);
    });

    it('rejects an unknown render mode', async () => {
      seq += 1;
      await expect(
        ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'longText',
            name: `F02-bad-${seq}`,
            options: { showAs: { type: 'plain' } } as never,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('F10 attachment cells', () => {
    let attachmentTableId: string;
    let attachmentFieldId: string;

    beforeAll(async () => {
      await ensureAttachmentTables(ctx);
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'F10 Attachments',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'attachment', name: 'Files' },
        ],
        views: [{ type: 'grid' }],
      });
      attachmentTableId = table.id;
      attachmentFieldId = fieldByName(table, 'Files').id;
    });

    afterAll(async () => {
      if (attachmentTableId) await ctx.deleteTable(attachmentTableId).catch(() => undefined);
    });

    it('stores file metadata rather than bytes', async () => {
      const seeded = await seedAttachment(ctx, 256);
      const cell = makeAttachmentCell(seeded, 'report.txt');
      const record = await ctx.createRecord(attachmentTableId, { [attachmentFieldId]: cell });

      const rows = await ctx.listRecords(attachmentTableId, { limit: 1000 });
      const stored = findRow(rows, record.id)?.fields[attachmentFieldId] as Array<
        Record<string, unknown>
      >;
      expect(Array.isArray(stored)).toBe(true);
      expect(stored[0]).toMatchObject({ name: 'report.txt', size: 256, mimetype: 'text/plain' });
    });

    it('adds totalAttachmentSize and reports occupancy', async () => {
      const seededA = await seedAttachment(ctx, 100);
      const seededB = await seedAttachment(ctx, 300);
      const withFile = await ctx.createRecord(attachmentTableId, {
        [attachmentFieldId]: makeAttachmentCell(seededA, 'a.txt'),
      });
      const withTwo = await ctx.createRecord(attachmentTableId, {
        [attachmentFieldId]: [
          ...makeAttachmentCell(seededA, 'a-again.txt'),
          ...makeAttachmentCell(seededB, 'b.txt'),
        ],
      });
      await ctx.drainOutbox();

      const total = Number(
        await statistic(attachmentTableId, attachmentFieldId, 'totalAttachmentSize')
      );
      const filled = Number(await statistic(attachmentTableId, attachmentFieldId, 'filled'));
      const count = Number(await statistic(attachmentTableId, attachmentFieldId, 'count'));

      // `filled`/`count` are per record; the size is summed over every file.
      expect(count).toBeGreaterThanOrEqual(3);
      expect(filled).toBeGreaterThanOrEqual(2);
      expect(total).toBeGreaterThanOrEqual(700);
      expect(withFile.id).toBeTruthy();
      expect(withTwo.id).toBeTruthy();

      const rows = await ctx.listRecords(attachmentTableId, { limit: 1000 });
      expect(findRow(rows, withTwo.id)?.fields[attachmentFieldId]).toHaveLength(2);
    });

    it('treats an empty attachment list as a cleared cell', async () => {
      const record = await ctx.createRecord(attachmentTableId, { [attachmentFieldId]: [] });
      const rows = await ctx.listRecords(attachmentTableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[attachmentFieldId] ?? null).toBeNull();
    });
  });
});
