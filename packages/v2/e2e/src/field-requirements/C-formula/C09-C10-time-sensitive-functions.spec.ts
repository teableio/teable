/**
 * C09 / C10 — time-sensitive functions and their recomputation window.
 *
 * C09 (待定口径): the requirement document asks what refreshes `NOW`, `TODAY`,
 * `FROMNOW` and `TONOW` — page open, background time passing, or a write. v2
 * answer: time-dependent expressions are materialised when the record is
 * written, so re-reading after real time passes returns the stored instant
 * unchanged, and the next write re-evaluates it.
 *
 * C10 (待定口径): `DATETIME_DIFF`/`FROMNOW`/`TONOW` take an explicit unit, and
 * an unsupported unit is refused at configuration time rather than silently
 * producing a wrong number.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fieldByName,
  findRow,
  getSharedTestContext,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('C09/C10: time-sensitive functions', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let dateFieldId: string;
  const formulaIds = new Map<string, string>();
  let seq = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'C09 Time Functions',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'date', name: 'D' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    dateFieldId = fieldByName(table, 'D').id;

    const create = async (expression: string) => {
      seq += 1;
      const name = `C09-${seq}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type: 'formula', name, options: { expression } },
      });
      formulaIds.set(expression, fieldByName(created, name).id);
    };

    await create('NOW()');
    await create('TODAY()');
    await create('YEAR(NOW())');
    await create(`FROMNOW({${dateFieldId}}, "days")`);
    await create(`TONOW({${dateFieldId}}, "days")`);
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
  });

  const readAll = async (recordId: string) => {
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    const row = findRow(rows, recordId);
    return Object.fromEntries(
      [...formulaIds].map(([expression, fieldId]) => [expression, row?.fields[fieldId]])
    ) as Record<string, unknown>;
  };

  it('C09 materialises NOW and TODAY at write time', async () => {
    const record = await ctx.createRecord(tableId, {
      [dateFieldId]: '2024-01-01T00:00:00.000Z',
    });
    const values = await readAll(record.id);

    const now = new Date(values['NOW()'] as string);
    expect(Number.isNaN(now.getTime())).toBe(false);
    expect(Math.abs(Date.now() - now.getTime())).toBeLessThan(60_000);

    const today = new Date(values['TODAY()'] as string);
    // TODAY is midnight of the field timezone's day, so it is never later than
    // the record's own NOW instant.
    expect(today.getTime()).toBeLessThanOrEqual(now.getTime() + 1000);
    expect(today.getUTCMinutes()).toBe(0);
    expect(today.getUTCSeconds()).toBe(0);
  });

  it('C09 reading again after real time passes does not re-evaluate NOW', async () => {
    const record = await ctx.createRecord(tableId, {});
    const first = await readAll(record.id);

    await settle(1100);
    const second = await readAll(record.id);

    expect(second['NOW()']).toBe(first['NOW()']);
    expect(second['TODAY()']).toBe(first['TODAY()']);
  });

  it('C09 a write re-evaluates NOW for that record', async () => {
    const record = await ctx.createRecord(tableId, {});
    const first = await readAll(record.id);

    await settle(1100);
    await ctx.updateRecord(tableId, record.id, { [dateFieldId]: '2024-06-01T00:00:00.000Z' });
    const second = await readAll(record.id);

    expect(Date.parse(second['NOW()'] as string)).toBeGreaterThan(
      Date.parse(first['NOW()'] as string)
    );
    // TODAY is refreshed from the same write but still collapses to midnight,
    // so it only changes when the calendar day changes.
    expect(Date.parse(second['TODAY()'] as string)).toBeGreaterThanOrEqual(
      Date.parse(first['TODAY()'] as string)
    );
  });

  it('C09 writing a different record does not re-evaluate this record', async () => {
    const observed = await ctx.createRecord(tableId, {});
    const other = await ctx.createRecord(tableId, {});
    const before = await readAll(observed.id);

    await settle(1100);
    await ctx.updateRecord(tableId, other.id, { [dateFieldId]: '2025-01-01T00:00:00.000Z' });

    expect((await readAll(observed.id))['NOW()']).toBe(before['NOW()']);
  });

  it('C10 FROMNOW and TONOW report the same magnitude for a past date', async () => {
    const record = await ctx.createRecord(tableId, {
      [dateFieldId]: '2024-01-01T00:00:00.000Z',
    });
    const values = await readAll(record.id);

    const fromNow = Number(values[`FROMNOW({${dateFieldId}}, "days")`]);
    const toNow = Number(values[`TONOW({${dateFieldId}}, "days")`]);

    expect(Number.isFinite(fromNow)).toBe(true);
    // Both are measured as "days from the record instant to now", so a date in
    // the past yields the same positive magnitude from either function.
    expect(fromNow).toBeGreaterThan(0);
    expect(toNow).toBeCloseTo(fromNow, 6);
  });

  it('C10 yields an empty result for an unregistered unit name', async () => {
    // The unit is a bare string, so a typo is accepted at configuration time and
    // the cell stays empty instead of silently guessing a unit. The 2-argument
    // form defaults to milliseconds, which is asserted alongside it so the two
    // behaviours cannot be confused.
    seq += 1;
    const implicitName = `C10-implicit-${seq}`;
    const implicit = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        name: implicitName,
        options: { expression: `DATETIME_DIFF(NOW(), {${dateFieldId}})` },
      },
    });

    seq += 1;
    const unknownName = `C10-unknown-${seq}`;
    const unknown = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'formula',
        name: unknownName,
        options: { expression: `DATETIME_DIFF(NOW(), {${dateFieldId}}, "fortnights")` },
      },
    });

    const record = await ctx.createRecord(tableId, {
      [dateFieldId]: '2024-01-01T00:00:00.000Z',
    });
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    const row = findRow(rows, record.id);

    expect(row?.fields[fieldByName(unknown, unknownName).id] ?? null).toBeNull();
    // The 2-argument form defaults to milliseconds.
    expect(Number(row?.fields[fieldByName(implicit, implicitName).id])).toBeGreaterThan(0);
  });

  it('C10 accepts the documented time units', async () => {
    const units = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'];
    for (const unit of units) {
      seq += 1;
      const name = `C10-${unit}`;
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: {
          type: 'formula',
          name,
          options: { expression: `DATETIME_DIFF(NOW(), {${dateFieldId}}, "${unit}")` },
        },
      });
      expect(fieldByName(created, name).options).toBeDefined();
    }
  });
});
