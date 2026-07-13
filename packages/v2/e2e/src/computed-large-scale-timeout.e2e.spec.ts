/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Large-scale computed update e2e (customer-shaped).
 *
 * Mirrors the orzgk space failure mode:
 * - large hub table (订单总表-like)
 * - downstream pending table with link + lookups + FIND formula
 * - update hub → cascade recomputes must finish under statement_timeout
 *
 * Proves:
 * 1) FIND on multi-select/json-ish values does not hard-fail (position(jsonb))
 * 2) link/lookup cascade over thousands of rows does not time out
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const HUB_ROWS = 2_000;
const PENDING_ROWS = 2_000;
const FANOUT_CHILDREN = 800;
const CREATE_BATCH = 100;
/** Must stay under worker default taskStatementTimeoutMs (60s). */
const MAX_DRAIN_MS = 45_000;

const cellText = (value: unknown): string => {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map((item) => cellText(item)).join(', ');
  }
  if (typeof value === 'object') {
    const obj = value as { title?: string; name?: string; id?: string };
    if (obj.title != null) return String(obj.title);
    if (obj.name != null) return String(obj.name);
    if (obj.id != null) return String(obj.id);
  }
  return String(value);
};

describe('v2 computed large-scale timeout (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldSeq = 0;

  const fid = (label: string) => {
    fieldSeq += 1;
    const suffix = `${label}${fieldSeq}`.replaceAll(/[^a-zA-Z0-9]/g, '').slice(0, 16);
    return `fld${suffix.padEnd(16, '0')}`;
  };

  const drainUntilIdle = async (maxRounds = 40) => {
    const started = Date.now();
    let rounds = 0;
    for (; rounds < maxRounds; rounds += 1) {
      const drained = await ctx.testContainer.processOutbox();
      if (drained === 0) break;
      if (Date.now() - started > MAX_DRAIN_MS) {
        throw new Error(
          `processOutbox exceeded ${MAX_DRAIN_MS}ms after ${rounds + 1} rounds (last drained=${drained})`
        );
      }
    }
    return { elapsedMs: Date.now() - started, rounds };
  };

  const createBatches = async (
    tableId: string,
    rows: Array<{ fields: Record<string, unknown> }>
  ) => {
    const created: Array<{ id: string; fields: Record<string, unknown> }> = [];
    for (let i = 0; i < rows.length; i += CREATE_BATCH) {
      const batch = rows.slice(i, i + CREATE_BATCH);
      const records = await ctx.createRecords(tableId, batch);
      created.push(...records);
    }
    return created;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  }, 120_000);

  it('hub → pending link/lookup/FIND cascade over thousands of rows completes under timeout', async () => {
    const orderNoFieldId = fid('ordNo');
    const productFieldId = fid('product');
    const ownerFieldId = fid('owner');
    const tagsFieldId = fid('tags');
    const reviewFormulaFieldId = fid('review');

    const hub = await ctx.createTable({
      baseId: ctx.baseId,
      name: `LargeHub_${Date.now()}`,
      fields: [
        {
          type: 'singleLineText',
          id: orderNoFieldId,
          name: '订单号',
          isPrimary: true,
        },
        { type: 'singleLineText', id: productFieldId, name: '产品版本' },
        {
          type: 'singleSelect',
          id: ownerFieldId,
          name: '归属对接',
          options: {
            choices: [
              { id: 'choJenny', name: 'Jenny④', color: 'redDark1' },
              { id: 'choShop', name: 'shop②+', color: 'tealLight2' },
            ],
          },
        },
        {
          type: 'multipleSelect',
          id: tagsFieldId,
          name: '销售2审',
          options: {
            choices: [
              { id: 'choGreen', name: '#92D050', color: 'greenLight2' },
              { id: 'choOpen', name: '有效(待定)', color: 'green' },
            ],
          },
        },
        {
          type: 'formula',
          id: reviewFormulaFieldId,
          name: '销售2审-公式',
          options: {
            // Customer-shaped FIND against multi-select (jsonb storage).
            expression: `IF(OR(FIND("#92D050", {${tagsFieldId}}) > 0, FIND("有效", {${tagsFieldId}}) > 0), "异常完结(有效单)", "待处理")`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const pendingOrderFieldId = fid('pOrd');
    const linkFieldId = fid('pLink');
    const lookupProductFieldId = fid('pProd');
    const lookupOwnerFieldId = fid('pOwn');
    const lookupReviewFieldId = fid('pRev');
    const pendingIssueFieldId = fid('pIssue');

    const pending = await ctx.createTable({
      baseId: ctx.baseId,
      name: `LargePending_${Date.now()}`,
      fields: [
        {
          type: 'singleLineText',
          id: pendingOrderFieldId,
          name: '订单号',
          isPrimary: true,
        },
        { type: 'singleLineText', id: pendingIssueFieldId, name: '具体需确认问题' },
        {
          type: 'link',
          id: linkFieldId,
          name: '订单总表',
          options: {
            foreignTableId: hub.id,
            relationship: 'manyOne',
            lookupFieldId: orderNoFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupProductFieldId,
          name: '产品版本(从总表查询)',
          options: {
            linkFieldId,
            foreignTableId: hub.id,
            lookupFieldId: productFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupOwnerFieldId,
          name: '归属/对接(从总表查询)',
          options: {
            linkFieldId,
            foreignTableId: hub.id,
            lookupFieldId: ownerFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupReviewFieldId,
          name: '审单公式(从总表查询)',
          options: {
            linkFieldId,
            foreignTableId: hub.id,
            lookupFieldId: reviewFormulaFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    // Seed hub rows
    const hubRows = Array.from({ length: HUB_ROWS }, (_, i) => ({
      fields: {
        [orderNoFieldId]: `ORD-${i}`,
        [productFieldId]: i % 2 === 0 ? 'Loiter Studio - A' : 'Loiter Studio - B',
        [ownerFieldId]: i % 3 === 0 ? 'Jenny④' : 'shop②+',
        [tagsFieldId]: i % 4 === 0 ? ['#92D050'] : ['有效(待定)'],
      },
    }));
    const hubRecords = await createBatches(hub.id, hubRows);
    expect(hubRecords.length).toBe(HUB_ROWS);
    await drainUntilIdle();

    // One-to-one pending rows linked by order
    const pendingRows = hubRecords.map((hubRec, i) => ({
      fields: {
        [pendingOrderFieldId]: `ORD-${i}`,
        [pendingIssueFieldId]: '工作室涨价，全款248改价为369',
        [linkFieldId]: { id: hubRec.id },
      },
    }));
    const pendingOneToOne = await createBatches(pending.id, pendingRows);
    expect(pendingOneToOne.length).toBe(PENDING_ROWS);
    await drainUntilIdle();

    // Extra fan-out: many pending rows point at hub[0] (oneMany reverse pressure)
    const fanoutHub = hubRecords[0];
    expect(fanoutHub).toBeDefined();
    const fanoutRows = Array.from({ length: FANOUT_CHILDREN }, (_, i) => ({
      fields: {
        [pendingOrderFieldId]: `FAN-${i}`,
        [pendingIssueFieldId]: 'fanout',
        [linkFieldId]: { id: fanoutHub!.id },
      },
    }));
    const fanoutCreated = await createBatches(pending.id, fanoutRows);
    expect(fanoutCreated.length).toBe(FANOUT_CHILDREN);
    await drainUntilIdle();

    // Mutate hub rows that drive lookups + FIND formula
    const targetHub = hubRecords[1] ?? hubRecords[0];
    expect(targetHub).toBeDefined();
    ctx.clearLogs();
    const updateStarted = Date.now();
    await ctx.updateRecord(hub.id, targetHub!.id, {
      [productFieldId]: 'Loiter Studio - UPDATED',
      [ownerFieldId]: 'Jenny④',
      [tagsFieldId]: ['#92D050'],
    });
    // Fan-out parent also changes (800 children lookups)
    await ctx.updateRecord(hub.id, fanoutHub!.id, {
      [productFieldId]: 'Fanout Product UPDATED',
      [ownerFieldId]: 'shop②+',
      [tagsFieldId]: ['有效(待定)'],
    });

    const drain = await drainUntilIdle();
    const totalMs = Date.now() - updateStarted;

    expect(drain.elapsedMs).toBeLessThan(MAX_DRAIN_MS);
    expect(totalMs).toBeLessThan(MAX_DRAIN_MS);

    const listAllPending = async () => {
      const pageSize = 200;
      const all: Array<{ id: string; fields: Record<string, unknown> }> = [];
      for (let offset = 0; offset < PENDING_ROWS + FANOUT_CHILDREN + pageSize; offset += pageSize) {
        const page = await ctx.listRecordsWithoutDrain(pending.id, {
          limit: pageSize,
          offset,
        });
        all.push(...page);
        if (page.length < pageSize) break;
      }
      return all;
    };

    const allPending = await listAllPending();
    expect(allPending.length).toBe(PENDING_ROWS + FANOUT_CHILDREN);
    const targetOrderNo = `ORD-${hubRecords.indexOf(targetHub!)}`;
    const sample =
      allPending.find((r) => r.fields[pendingOrderFieldId] === targetOrderNo) ??
      allPending.find((r) => {
        const link = r.fields[linkFieldId] as { id?: string } | Array<{ id?: string }> | undefined;
        if (Array.isArray(link)) return link.some((item) => item.id === targetHub!.id);
        return link?.id === targetHub!.id;
      });
    expect(sample).toBeDefined();
    expect(cellText(sample!.fields[lookupProductFieldId])).toBe('Loiter Studio - UPDATED');
    expect(cellText(sample!.fields[lookupOwnerFieldId])).toBe('Jenny④');
    // Formula FIND against multi-select must compute, not die in dead-letter
    expect(cellText(sample!.fields[lookupReviewFieldId])).toBe('异常完结(有效单)');

    // Fan-out child must also refresh
    const fanChild = allPending.find((r) => r.fields[pendingOrderFieldId] === 'FAN-0');
    expect(fanChild).toBeDefined();
    expect(cellText(fanChild!.fields[lookupProductFieldId])).toBe('Fanout Product UPDATED');
    expect(cellText(fanChild!.fields[lookupOwnerFieldId])).toBe('shop②+');
    expect(cellText(fanChild!.fields[lookupReviewFieldId])).toBe('异常完结(有效单)');

    // Hub formula itself
    const hubAfter = await ctx.listRecordsWithoutDrain(hub.id, { limit: 50, offset: 0 });
    const hubSample =
      hubAfter.find((r) => r.id === targetHub!.id) ??
      (
        await ctx.listRecordsWithoutDrain(hub.id, {
          limit: 50,
          offset: Math.max(0, hubRecords.indexOf(targetHub!) - 10),
        })
      ).find((r) => r.id === targetHub!.id);
    expect(hubSample).toBeDefined();
    expect(cellText(hubSample?.fields[reviewFormulaFieldId])).toBe('异常完结(有效单)');
  }, 180_000);

  it('FIND formula on multiSelect alone does not throw position(jsonb) under bulk update', async () => {
    const nameFieldId = fid('nm');
    const tagsFieldId = fid('tg');
    const findFieldId = fid('fd');

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `FindJsonb_${Date.now()}`,
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        {
          type: 'multipleSelect',
          id: tagsFieldId,
          name: 'Tags',
          options: {
            choices: [
              { id: 'choA', name: '#92D050', color: 'greenLight2' },
              { id: 'choB', name: 'other', color: 'gray' },
            ],
          },
        },
        {
          type: 'formula',
          id: findFieldId,
          name: 'FindTag',
          options: {
            expression: `IF(FIND("#92D050", {${tagsFieldId}}) > 0, "hit", "miss")`,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const rows = Array.from({ length: 500 }, (_, i) => ({
      fields: {
        [nameFieldId]: `R${i}`,
        [tagsFieldId]: i % 2 === 0 ? ['#92D050'] : ['other'],
      },
    }));
    const records = await createBatches(table.id, rows);
    await drainUntilIdle();

    const started = Date.now();
    // Bulk-ish updates: multiple single-record updates then one drain (computed outbox).
    for (const record of records.slice(0, 100)) {
      await ctx.updateRecord(table.id, record.id, {
        [tagsFieldId]: ['#92D050'],
      });
    }
    const drain = await drainUntilIdle();
    expect(Date.now() - started).toBeLessThan(MAX_DRAIN_MS);
    expect(drain.elapsedMs).toBeLessThan(MAX_DRAIN_MS);

    const after = await ctx.listRecordsWithoutDrain(table.id, { limit: 20 });
    const hits = after.filter((r) => r.fields[findFieldId] === 'hit');
    expect(hits.length).toBeGreaterThan(0);
  }, 120_000);
});
