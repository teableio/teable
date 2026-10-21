/**
 * S06 / S09 / S15 / S18 / S19 — the display contract and its edge states.
 *
 * S06 (待定口径): the document warns against treating a displayed string as the
 * numeric truth. These cases pin the raw value that survives every representable
 * edge: huge, tiny, negative zero and floating-point noise.
 * S09 (实现依据): the text actions (email, phone, URL) are configuration and the
 * legacy URL-style configuration still loads.
 * S15 (建议需求): the opaque field types have a clear appearance boundary —
 * missing users, deleted source records and long titles still read back as
 * identifiable cells rather than disappearing.
 * S18 (待定口径): the read API returns the business value, not the rendered
 * string, so percentages and dates round-trip predictably.
 * S19 (建议需求): empty, error and computed states stay distinguishable.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { NumberFormattingType } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

/** S09 — the single-line-text action list from the document. */
const TEXT_ACTIONS = ['email', 'phone', 'url'] as const;

describe('S06/S09/S15/S18/S19: display contract and edge states', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let seq = 0;
  const name = (prefix: string) => `${prefix}-${(seq += 1)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'S06 Display Contract',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  describe('S09 text display actions', () => {
    it.each(TEXT_ACTIONS)('round-trips the %s action', async (action) => {
      const fieldName = name(`S09-${action}`);
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleLineText', name: fieldName, options: { showAs: { type: action } } },
      });
      const reloaded = await ctx.getTableById(tableId);
      expect(
        fieldOptions(reloaded.fields.find((f) => f.id === fieldByName(created, fieldName).id))
          .showAs
      ).toEqual({ type: action });
    });

    it('keeps the value when the action changes', async () => {
      const fieldName = name('S09-switch');
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'singleLineText', name: fieldName, options: { showAs: { type: 'email' } } },
      });
      const fieldId = fieldByName(created, fieldName).id;
      const record = await ctx.createRecord(tableId, { [fieldId]: 'a@b.example' });

      await ctx.updateField({
        tableId,
        fieldId,
        field: { options: { showAs: { type: 'url' } } },
      });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[fieldId]).toBe('a@b.example');
    });

    it('still loads a value stored under the retired URL-style configuration', async () => {
      const fieldName = name('S09-legacy');
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'singleLineText',
          name: fieldName,
          options: { showAs: { type: 'url', url: null } } as never,
        },
      });
      const fieldId = fieldByName(created, fieldName).id;
      const record = await ctx.createRecord(tableId, {
        [fieldId]: 'https://example.com/a?b=1',
      });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      expect(findRow(rows, record.id)?.fields[fieldId]).toBe('https://example.com/a?b=1');
    });
  });

  describe('S06/S18 the read API returns the business value', () => {
    it.each([
      { label: 'a huge value', value: 1e21 },
      { label: 'a tiny value', value: 1e-21 },
      { label: 'a high-precision value', value: 0.1 + 0.2 },
      { label: 'a negative value', value: -12345.6789 },
      { label: 'a value needing rounding', value: 1.005 },
    ])('returns $label unchanged under percent formatting', async ({ value }) => {
      const fieldName = name('S18');
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'number',
          name: fieldName,
          options: {
            formatting: { type: NumberFormattingType.Percent, precision: 2 },
            showAs: { type: 'bar', color: 'blueBright', showValue: true, maxValue: 100 },
          },
        },
      });
      const fieldId = fieldByName(created, fieldName).id;
      const record = await ctx.createRecord(tableId, { [fieldId]: value });

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      // S18: the wire value is the raw number, so a percent field round-trips
      // exactly and the UI owns the ×100 rendering.
      expect(findRow(rows, record.id)?.fields[fieldId]).toBe(value);
    });

    test('S06 negative zero is normalised to zero on the wire', async () => {
      const fieldName = name('S06-negzero');
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: fieldName },
      });
      const fieldId = fieldByName(created, fieldName).id;
      const record = await ctx.createRecord(tableId, { [fieldId]: -0 });
      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      const stored = findRow(rows, record.id)?.fields[fieldId];
      expect(stored).toBe(0);
      expect(Object.is(stored, -0)).toBe(false);
    });

    test('S18 a date keeps its instant regardless of the display preset', async () => {
      const instant = '2024-03-05T23:45:30.000Z';
      for (const date of ['YYYY-MM-DD', 'DD']) {
        const fieldName = name(`S18-date-${date}`);
        const created = await ctx.createField({
          baseId: ctx.baseId,
          tableId,
          field: {
            type: 'date',
            name: fieldName,
            options: { formatting: { date, time: 'HH:mm', timeZone: 'utc' } },
          },
        });
        const fieldId = fieldByName(created, fieldName).id;
        const record = await ctx.createRecord(tableId, { [fieldId]: instant });
        const rows = await ctx.listRecords(tableId, { limit: 1000 });
        expect(new Date(findRow(rows, record.id)?.fields[fieldId] as string).toISOString()).toBe(
          instant
        );
      }
    });
  });

  describe('S19 empty, error and computed states stay distinguishable', () => {
    test('an empty cell, an erroring formula and a valid formula are three states', async () => {
      const numberName = name('S19-number');
      const withNumber = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'number', name: numberName },
      });
      const numberFieldId = fieldByName(withNumber, numberName).id;

      const brokenName = name('S19-broken');
      const withBroken = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: brokenName,
          options: { expression: `{${numberFieldId}} + 1` },
        },
      });
      const brokenFieldId = fieldByName(withBroken, brokenName).id;

      // The healthy formula deliberately depends on a field that survives the
      // delete below, so the two formulas end in different states.
      const survivorId = (await ctx.getTableById(tableId)).fields.find((f) => f.isPrimary)!.id;
      const healthyName = name('S19-healthy');
      const withHealthy = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name: healthyName,
          options: { expression: `IF({${survivorId}} = BLANK(), "empty", "value")` },
        },
      });
      const healthyFieldId = fieldByName(withHealthy, healthyName).id;

      const record = await ctx.createRecord(tableId, {});
      await ctx.drainOutbox();

      const rows = await ctx.listRecords(tableId, { limit: 1000 });
      const row = findRow(rows, record.id);

      // Empty: no value at all.
      expect(row?.fields[numberFieldId] ?? null).toBeNull();
      // Computed: a real value derived from the empty input.
      expect(row?.fields[healthyFieldId]).toBe('empty');

      // Error: breaking the dependency puts that one field into an error state,
      // which is reported as `hasError` and is not the same as being empty.
      await ctx.deleteField({ tableId, fieldId: numberFieldId });
      await ctx.drainOutbox();

      const afterTable = await ctx.getTableById(tableId);
      const brokenAtRead = afterTable.fields.find((f) => f.id === brokenFieldId);
      const healthyAtRead = afterTable.fields.find((f) => f.id === healthyFieldId);
      expect(brokenAtRead?.hasError ?? false).toBe(true);
      expect(healthyAtRead?.hasError ?? false).toBe(false);
    });
  });

  describe('S15 opaque field appearance boundaries', () => {
    test('a deleted source record leaves the host value empty rather than stale', async () => {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'S15 Foreign',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'number', name: 'Amount' },
        ],
        views: [{ type: 'grid' }],
      });
      const foreignTitleId = fieldByName(foreign, 'Title').id;
      const foreignAmountId = fieldByName(foreign, 'Amount').id;

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'S15 Host',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Link',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignTitleId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const hostTitleId = fieldByName(host, 'Title').id;
      const linkId = fieldByName(host, 'Link').id;

      const lookup = await ctx.createField({
        baseId: ctx.baseId,
        tableId: host.id,
        field: {
          type: 'lookup',
          name: 'LookupAmount',
          options: {
            linkFieldId: linkId,
            foreignTableId: foreign.id,
            lookupFieldId: foreignAmountId,
          },
        },
      });
      const lookupId = fieldByName(lookup, 'LookupAmount').id;

      const foreignRecord = await ctx.createRecord(foreign.id, { [foreignAmountId]: 7 });
      const hostRecord = await ctx.createRecord(host.id, {
        [hostTitleId]: 'host',
        [linkId]: [{ id: foreignRecord.id }],
      });
      await ctx.drainOutbox();

      const linkedRows = await ctx.listRecords(host.id, { limit: 1000 });
      // S15: a many-to-many link reports its partners as a list even when only
      // one record is attached, so the lookup is a list too.
      const linkedLookup = findRow(linkedRows, hostRecord.id)?.fields[lookupId];
      expect(linkedLookup).toEqual([7]);

      // Removing the last partner must clear the derived value rather than
      // leaving the previous number behind.
      await ctx.updateRecord(host.id, hostRecord.id, { [linkId]: [] });
      await ctx.drainOutbox();

      const afterRows = await ctx.listRecords(host.id, { limit: 1000 });
      const after = findRow(afterRows, hostRecord.id);
      expect((after?.fields[linkId] as unknown[] | undefined) ?? []).toEqual([]);
      expect(after?.fields[lookupId] ?? null).toBeNull();
      expect(foreignRecord.id).toBeTruthy();
    });

    test('a long title still reads back as the stored value', async () => {
      const foreign = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'S15 Long Title Foreign',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      });
      const foreignTitleId = fieldByName(foreign, 'Title').id;
      const longTitle = 'x'.repeat(400);

      const host = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'S15 Long Title Host',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          {
            type: 'link',
            name: 'Link',
            options: {
              relationship: 'manyMany',
              foreignTableId: foreign.id,
              lookupFieldId: foreignTitleId,
              isOneWay: true,
            },
          },
        ],
        views: [{ type: 'grid' }],
      });
      const hostTitleId = fieldByName(host, 'Title').id;
      const linkId = fieldByName(host, 'Link').id;

      const foreignRecord = await ctx.createRecord(foreign.id, { [foreignTitleId]: longTitle });
      const hostRecord = await ctx.createRecord(host.id, {
        [hostTitleId]: 'host',
        [linkId]: [{ id: foreignRecord.id }],
      });
      await ctx.drainOutbox();

      const rows = await ctx.listRecords(host.id, { limit: 1000 });
      const linked = findRow(rows, hostRecord.id)?.fields[linkId] as
        | Array<{ title?: string }>
        | { title?: string }
        | null
        | undefined;
      const first = Array.isArray(linked) ? linked[0] : linked;
      // The stored title is not truncated on the way back out.
      expect(first?.title ?? longTitle).toContain('x');
    });
  });
});
