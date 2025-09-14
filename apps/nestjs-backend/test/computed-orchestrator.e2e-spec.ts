/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { duplicateField, convertField } from '@teable/openapi';
import type { Knex } from 'knex';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEventWithResultWithCount } from './utils/event-promise';
import {
  deleteField,
  createField,
  createTable,
  getFields,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Computed Orchestrator (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;
  let prisma: PrismaService;
  let knex: Knex;
  let db: IDbProvider;
  const baseId = (globalThis as any).testConfig.baseId as string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
    prisma = app.get(PrismaService);
    knex = app.get('CUSTOM_KNEX' as any);
    db = app.get<IDbProvider>(DB_PROVIDER_SYMBOL as any);
  });

  afterAll(async () => {
    await app.close();
  });

  async function runAndCaptureRecordUpdates<T>(fn: () => Promise<T>): Promise<{
    result: T;
    events: any[];
  }> {
    const events: any[] = [];
    const handler = (payload: any) => events.push(payload);
    eventEmitterService.eventEmitter.on(Events.TABLE_RECORD_UPDATE, handler);
    try {
      const result = await fn();
      // allow async emission to flush
      await new Promise((r) => setTimeout(r, 20));
      return { result, events };
    } finally {
      eventEmitterService.eventEmitter.off(Events.TABLE_RECORD_UPDATE, handler);
    }
  }

  // ---- DB helpers for asserting physical columns ----
  const getDbTableName = async (tableId: string) => {
    const { dbTableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return dbTableName as string;
  };

  const getRow = async (dbTableName: string, id: string) => {
    return (
      await prisma.$queryRawUnsafe<any[]>(knex(dbTableName).select('*').where('__id', id).toQuery())
    )[0];
  };

  const parseMaybe = (v: unknown) => {
    if (typeof v === 'string') {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  };

  // ===== Formula related =====
  describe('Formula', () => {
    it('emits old/new values for formula on same table when base field changes', async () => {
      const table = await createTable(baseId, {
        name: 'OldNew_Formula',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 1 } }],
      });
      const aId = table.fields.find((f) => f.name === 'A')!.id;
      const f1 = await createField(table.id, {
        name: 'F1',
        type: FieldType.Formula,
        options: { expression: `{${aId}}` },
      } as IFieldRo);

      await updateRecordByApi(table.id, table.records[0].id, aId, 1);

      // Expect a single record.update event; assert old/new for formula field
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        1
      )(async () => {
        await updateRecordByApi(table.id, table.records[0].id, aId, 2);
      })) as any;

      const event = payloads[0] as any; // RecordUpdateEvent
      expect(event.payload.tableId).toBe(table.id);
      const changes = event.payload.record.fields as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      // Formula F1 should move from 1 -> 2
      expect(changes[f1.id]).toBeDefined();
      expect(changes[f1.id].oldValue).toEqual(1);
      expect(changes[f1.id].newValue).toEqual(2);

      // Assert physical column for formula (non-generated) reflects new value
      const tblName = await getDbTableName(table.id);
      const row = await getRow(tblName, table.records[0].id);
      const f1Full = (await getFields(table.id)).find((f) => f.id === (f1 as any).id)! as any;
      expect(parseMaybe((row as any)[f1Full.dbFieldName])).toEqual(2);

      await permanentDeleteTable(baseId, table.id);
    });

    it('Formula unchanged should not emit computed change', async () => {
      // T with A and F = {A}*{A}; change A: 1 -> -1, F stays 1
      const table = await createTable(baseId, {
        name: 'NoEvent_Formula_NoChange',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 1 } }],
      });
      const aId = table.fields.find((f) => f.name === 'A')!.id;
      const f = await createField(table.id, {
        name: 'F',
        type: FieldType.Formula,
        // F = A*A, so 1 -> -1 leaves F = 1 unchanged
        options: { expression: `{${aId}} * {${aId}}` },
      } as IFieldRo);

      // Prime value
      await updateRecordByApi(table.id, table.records[0].id, aId, 1);

      // Expect a single update event, and it should NOT include a change entry for F
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        1
      )(async () => {
        await updateRecordByApi(table.id, table.records[0].id, aId, -1);
      })) as any;

      const event = payloads[0] as any;
      const recs = Array.isArray(event.payload.record)
        ? event.payload.record
        : [event.payload.record];
      const change = recs[0]?.fields?.[f.id];
      expect(change).toBeUndefined();

      // DB: F should remain 1
      const tblName = await getDbTableName(table.id);
      const row = await getRow(tblName, table.records[0].id);
      const fFull = (await getFields(table.id)).find((x) => x.id === (f as any).id)! as any;
      expect(parseMaybe((row as any)[fFull.dbFieldName])).toEqual(1);

      await permanentDeleteTable(baseId, table.id);
    });

    it('Formula referencing formula: base change cascades old/new for all computed', async () => {
      // T with base A and chained formulas: B={A}+1, C={B}*2, D={C}-{A}
      const table = await createTable(baseId, {
        name: 'Formula_Chain',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 2 } }],
      });
      const aId = table.fields.find((f) => f.name === 'A')!.id;

      const b = await createField(table.id, {
        name: 'B',
        type: FieldType.Formula,
        options: { expression: `{${aId}} + 1` },
      } as IFieldRo);
      const c = await createField(table.id, {
        name: 'C',
        type: FieldType.Formula,
        options: { expression: `{${b.id}} * 2` },
      } as IFieldRo);
      const d = await createField(table.id, {
        name: 'D',
        type: FieldType.Formula,
        options: { expression: `{${c.id}} - {${aId}}` },
      } as IFieldRo);

      // Prime value to 2
      await updateRecordByApi(table.id, table.records[0].id, aId, 2);

      // Expect a single update event on this table; verify B,C,D old/new
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        1
      )(async () => {
        await updateRecordByApi(table.id, table.records[0].id, aId, 3);
      })) as any;

      const event = payloads[0] as any;
      expect(event.payload.tableId).toBe(table.id);
      const rec = Array.isArray(event.payload.record)
        ? event.payload.record[0]
        : event.payload.record;
      const changes = rec.fields as Record<string, { oldValue: unknown; newValue: unknown }>;

      // A: 2 -> 3, so B: 3 -> 4, C: 6 -> 8, D: 4 -> 5
      expect(changes[b.id]).toBeDefined();
      expect(changes[b.id].oldValue).toEqual(3);
      expect(changes[b.id].newValue).toEqual(4);

      expect(changes[c.id]).toBeDefined();
      expect(changes[c.id].oldValue).toEqual(6);
      expect(changes[c.id].newValue).toEqual(8);

      expect(changes[d.id]).toBeDefined();
      expect(changes[d.id].oldValue).toEqual(4);
      expect(changes[d.id].newValue).toEqual(5);

      // DB: B=4, C=8, D=5
      const dbName = await getDbTableName(table.id);
      const row = await getRow(dbName, table.records[0].id);
      const fields = await getFields(table.id);
      const bFull = fields.find((x) => x.id === (b as any).id)! as any;
      const cFull = fields.find((x) => x.id === (c as any).id)! as any;
      const dFull = fields.find((x) => x.id === (d as any).id)! as any;
      expect(parseMaybe((row as any)[bFull.dbFieldName])).toEqual(4);
      expect(parseMaybe((row as any)[cFull.dbFieldName])).toEqual(8);
      expect(parseMaybe((row as any)[dFull.dbFieldName])).toEqual(5);

      await permanentDeleteTable(baseId, table.id);
    });
  });

  // ===== Lookup & Rollup related =====
  describe('Lookup & Rollup', () => {
    it('updates lookup when link changes (ManyOne, single value)', async () => {
      // T1 with numeric source
      const t1 = await createTable(baseId, {
        name: 'LinkChange_M1_T1',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 123 } }, { fields: { A: 456 } }],
      });
      const aId = t1.fields.find((f) => f.name === 'A')!.id;

      // T2 with ManyOne link -> T1 and a lookup of A
      const t2 = await createTable(baseId, {
        name: 'LinkChange_M1_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const link = await createField(t2.id, {
        name: 'L_T1_M1',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyOne, foreignTableId: t1.id },
      } as IFieldRo);
      const lkp = await createField(t2.id, {
        name: 'LKP_A',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { foreignTableId: t1.id, linkFieldId: link.id, lookupFieldId: aId } as any,
      } as any);

      // Set link to first record (A=123)
      await updateRecordByApi(t2.id, t2.records[0].id, link.id, { id: t1.records[0].id });

      // Switch link to second record (A=456). Capture updates; assert T2 lookup old/new and DB persisted
      const { events } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(t2.id, t2.records[0].id, link.id, { id: t1.records[1].id });
      });

      const evt = events.find((e) => e.payload.tableId === t2.id)!;
      const rec = Array.isArray(evt.payload.record) ? evt.payload.record[0] : evt.payload.record;
      const changes = rec.fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(changes[lkp.id]).toBeDefined();
      expect(changes[lkp.id].oldValue).toEqual(123);
      expect(changes[lkp.id].newValue).toEqual(456);

      const t2Db = await getDbTableName(t2.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const lkpFull = (await getFields(t2.id)).find((f) => f.id === (lkp as any).id)! as any;
      expect(parseMaybe((t2Row as any)[lkpFull.dbFieldName])).toEqual(456);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('updates lookup when link array shrinks (OneMany, multi value)', async () => {
      // T2 with numeric values
      const t2 = await createTable(baseId, {
        name: 'LinkChange_OM_T2',
        fields: [{ name: 'V', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { V: 123 } }, { fields: { V: 456 } }],
      });
      const vId = t2.fields.find((f) => f.name === 'V')!.id;

      // T1 with OneMany link -> T2 and lookup of V
      const t1 = await createTable(baseId, {
        name: 'LinkChange_OM_T1',
        fields: [],
        records: [{ fields: {} }],
      });
      const link = await createField(t1.id, {
        name: 'L_T2_OM',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: t2.id },
      } as IFieldRo);
      const lkp = await createField(t1.id, {
        name: 'LKP_V',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { foreignTableId: t2.id, linkFieldId: link.id, lookupFieldId: vId } as any,
      } as any);

      // Set link to two records [123, 456]
      await updateRecordByApi(t1.id, t1.records[0].id, link.id, [
        { id: t2.records[0].id },
        { id: t2.records[1].id },
      ]);

      // Shrink to single record [123]; assert T1 lookup old/new and DB persisted
      const { events } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(t1.id, t1.records[0].id, link.id, [{ id: t2.records[0].id }]);
      });

      const evt = events.find((e) => e.payload.tableId === t1.id)!;
      const rec = Array.isArray(evt.payload.record) ? evt.payload.record[0] : evt.payload.record;
      const changes = rec.fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(changes[lkp.id]).toBeDefined();
      expect(changes[lkp.id].oldValue).toEqual([123, 456]);
      expect(changes[lkp.id].newValue).toEqual([123]);

      const t1Db = await getDbTableName(t1.id);
      const t1Row = await getRow(t1Db, t1.records[0].id);
      const lkpFull = (await getFields(t1.id)).find((f) => f.id === (lkp as any).id)! as any;
      expect(parseMaybe((t1Row as any)[lkpFull.dbFieldName])).toEqual([123]);

      await permanentDeleteTable(baseId, t1.id);
      await permanentDeleteTable(baseId, t2.id);
    });

    it('updates lookup to null when link cleared (OneMany, multi value)', async () => {
      // T2 with numeric values
      const t2 = await createTable(baseId, {
        name: 'LinkClear_OM_T2',
        fields: [{ name: 'V', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { V: 11 } }, { fields: { V: 22 } }],
      });
      const vId = t2.fields.find((f) => f.name === 'V')!.id;

      // T1 with OneMany link -> T2 and lookup of V
      const t1 = await createTable(baseId, {
        name: 'LinkClear_OM_T1',
        fields: [],
        records: [{ fields: {} }],
      });
      const link = await createField(t1.id, {
        name: 'L_T2_OM_Clear',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: t2.id },
      } as IFieldRo);
      const lkp = await createField(t1.id, {
        name: 'LKP_V_Clear',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { foreignTableId: t2.id, linkFieldId: link.id, lookupFieldId: vId } as any,
      } as any);

      // Set link to two records [11, 22]
      await updateRecordByApi(t1.id, t1.records[0].id, link.id, [
        { id: t2.records[0].id },
        { id: t2.records[1].id },
      ]);

      // Clear link to null; assert old/new and DB persisted NULL
      const { events } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(t1.id, t1.records[0].id, link.id, null);
      });

      const evt = events.find((e) => e.payload.tableId === t1.id)!;
      const rec = Array.isArray(evt.payload.record) ? evt.payload.record[0] : evt.payload.record;
      const changes = rec.fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(changes[lkp.id]).toBeDefined();
      expect(changes[lkp.id].oldValue).toEqual([11, 22]);
      expect(changes[lkp.id].newValue).toBeNull();

      const t1Db = await getDbTableName(t1.id);
      const t1Row = await getRow(t1Db, t1.records[0].id);
      const lkpFull = (await getFields(t1.id)).find((f) => f.id === (lkp as any).id)! as any;
      expect((t1Row as any)[lkpFull.dbFieldName]).toBeNull();

      await permanentDeleteTable(baseId, t1.id);
      await permanentDeleteTable(baseId, t2.id);
    });

    it('updates lookup when link is replaced (ManyMany, multi value -> multi value)', async () => {
      // T1 with numeric values
      const t1 = await createTable(baseId, {
        name: 'LinkReplace_MM_T1',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 5 } }, { fields: { A: 7 } }],
      });
      const aId = t1.fields.find((f) => f.name === 'A')!.id;

      // T2 with ManyMany link -> T1 and lookup of A
      const t2 = await createTable(baseId, {
        name: 'LinkReplace_MM_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const link = await createField(t2.id, {
        name: 'L_T1_MM',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);
      const lkp = await createField(t2.id, {
        name: 'LKP_A_MM',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { foreignTableId: t1.id, linkFieldId: link.id, lookupFieldId: aId } as any,
      } as any);

      // Set link to [r1] -> lookup [5]
      await updateRecordByApi(t2.id, t2.records[0].id, link.id, [{ id: t1.records[0].id }]);

      // Replace with [r2] -> lookup [7]
      const { events } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(t2.id, t2.records[0].id, link.id, [{ id: t1.records[1].id }]);
      });

      const evt = events.find((e) => e.payload.tableId === t2.id)!;
      const rec = Array.isArray(evt.payload.record) ? evt.payload.record[0] : evt.payload.record;
      const changes = rec.fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(changes[lkp.id]).toBeDefined();
      expect(changes[lkp.id].oldValue).toEqual([5]);
      expect(changes[lkp.id].newValue).toEqual([7]);

      const t2Db = await getDbTableName(t2.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const lkpFull = (await getFields(t2.id)).find((f) => f.id === (lkp as any).id)! as any;
      expect(parseMaybe((t2Row as any)[lkpFull.dbFieldName])).toEqual([7]);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });
    it('emits old/new values for lookup across tables when source changes', async () => {
      // T1 with number
      const t1 = await createTable(baseId, {
        name: 'OldNew_Lookup_T1',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 10 } }],
      });
      const t1A = t1.fields.find((f) => f.name === 'A')!.id;

      await updateRecordByApi(t1.id, t1.records[0].id, t1A, 10);

      // T2 link -> T1 and lookup A
      const t2 = await createTable(baseId, {
        name: 'OldNew_Lookup_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const link2 = await createField(t2.id, {
        name: 'L2',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);
      const lkp2 = await createField(t2.id, {
        name: 'LK1',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { foreignTableId: t1.id, linkFieldId: link2.id, lookupFieldId: t1A } as any,
      } as any);

      // Establish link values
      await updateRecordByApi(t2.id, t2.records[0].id, link2.id, [{ id: t1.records[0].id }]);

      // Expect two record.update events (T1 base, T2 lookup). Assert T2 lookup old/new
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t1.id, t1.records[0].id, t1A, 20);
      })) as any;

      // Find T2 event
      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
      const changes = t2Event.payload.record.fields as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(changes[lkp2.id]).toBeDefined();
      expect(changes[lkp2.id].oldValue).toEqual([10]);
      expect(changes[lkp2.id].newValue).toEqual([20]);

      // DB: lookup column should be [20]
      const t2Db = await getDbTableName(t2.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const lkp2Full = (await getFields(t2.id)).find((f) => f.id === (lkp2 as any).id)! as any;
      expect(parseMaybe((t2Row as any)[lkp2Full.dbFieldName])).toEqual([20]);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('emits old/new values for rollup across tables when source changes', async () => {
      // T1 with numbers
      const t1 = await createTable(baseId, {
        name: 'OldNew_Rollup_T1',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 3 } }, { fields: { A: 7 } }],
      });
      const t1A = t1.fields.find((f) => f.name === 'A')!.id;

      await updateRecordByApi(t1.id, t1.records[0].id, t1A, 3);
      await updateRecordByApi(t1.id, t1.records[1].id, t1A, 7);

      // T2 link -> T1 with rollup sum(A)
      const t2 = await createTable(baseId, {
        name: 'OldNew_Rollup_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const link2 = await createField(t2.id, {
        name: 'L2',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);
      const roll2 = await createField(t2.id, {
        name: 'R2',
        type: FieldType.Rollup,
        lookupOptions: { foreignTableId: t1.id, linkFieldId: link2.id, lookupFieldId: t1A } as any,
        options: { expression: 'sum({values})' } as any,
      } as any);

      // Establish links: T2 -> both rows in T1
      await updateRecordByApi(t2.id, t2.records[0].id, link2.id, [
        { id: t1.records[0].id },
        { id: t1.records[1].id },
      ]);

      // Change one A: 3 -> 4; rollup 10 -> 11
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t1.id, t1.records[0].id, t1A, 4);
      })) as any;

      // Find T2 event
      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
      const changes = t2Event.payload.record.fields as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(changes[roll2.id]).toBeDefined();
      expect(changes[roll2.id].oldValue).toEqual(10);
      expect(changes[roll2.id].newValue).toEqual(11);

      // DB: rollup column should be 11
      const t2Db = await getDbTableName(t2.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const roll2Full = (await getFields(t2.id)).find((f) => f.id === (roll2 as any).id)! as any;
      expect(parseMaybe((t2Row as any)[roll2Full.dbFieldName])).toEqual(11);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('Cross-table chain: T3.lookup(T2.lookup(T1.formula(A))) updates when A changes', async () => {
      // T1: A (number), F = A*3
      const t1 = await createTable(baseId, {
        name: 'Chain3_T1',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 4 } }],
      });
      const aId = t1.fields.find((f) => f.name === 'A')!.id;
      const f1 = await createField(t1.id, {
        name: 'F',
        type: FieldType.Formula,
        options: { expression: `{${aId}} * 3` },
      } as IFieldRo);
      // Prime A
      await updateRecordByApi(t1.id, t1.records[0].id, aId, 4);

      // T2: link -> T1, LKP2 = lookup(F)
      const t2 = await createTable(baseId, {
        name: 'Chain3_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const l12 = await createField(t2.id, {
        name: 'L_T1',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);
      const lkp2 = await createField(t2.id, {
        name: 'LKP2',
        type: FieldType.Formula,
        isLookup: true,
        lookupOptions: { foreignTableId: t1.id, linkFieldId: l12.id, lookupFieldId: f1.id } as any,
      } as any);
      await updateRecordByApi(t2.id, t2.records[0].id, l12.id, [{ id: t1.records[0].id }]);

      // T3: link -> T2, LKP3 = lookup(LKP2)
      const t3 = await createTable(baseId, {
        name: 'Chain3_T3',
        fields: [],
        records: [{ fields: {} }],
      });
      const l23 = await createField(t3.id, {
        name: 'L_T2',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t2.id },
      } as IFieldRo);
      const lkp3 = await createField(t3.id, {
        name: 'LKP3',
        type: FieldType.Formula,
        isLookup: true,
        lookupOptions: {
          foreignTableId: t2.id,
          linkFieldId: l23.id,
          lookupFieldId: lkp2.id,
        } as any,
      } as any);
      await updateRecordByApi(t3.id, t3.records[0].id, l23.id, [{ id: t2.records[0].id }]);

      // Change A: 4 -> 5; then F: 12 -> 15; LKP2: [12] -> [15]; LKP3: [12] -> [15]
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        3
      )(async () => {
        await updateRecordByApi(t1.id, t1.records[0].id, aId, 5);
      })) as any;

      // T1
      const t1Event = (payloads as any[]).find((e) => e.payload.tableId === t1.id)!;
      const t1Changes = (
        Array.isArray(t1Event.payload.record) ? t1Event.payload.record[0] : t1Event.payload.record
      ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(t1Changes[f1.id]).toBeDefined();
      expect(t1Changes[f1.id].oldValue).toEqual(12);
      expect(t1Changes[f1.id].newValue).toEqual(15);

      // T2
      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
      const t2Changes = (
        Array.isArray(t2Event.payload.record) ? t2Event.payload.record[0] : t2Event.payload.record
      ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(t2Changes[lkp2.id]).toBeDefined();
      expect(t2Changes[lkp2.id].oldValue).toEqual([12]);
      expect(t2Changes[lkp2.id].newValue).toEqual([15]);

      // T3
      const t3Event = (payloads as any[]).find((e) => e.payload.tableId === t3.id)!;
      const t3Changes = (
        Array.isArray(t3Event.payload.record) ? t3Event.payload.record[0] : t3Event.payload.record
      ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(t3Changes[lkp3.id]).toBeDefined();
      expect(t3Changes[lkp3.id].oldValue).toEqual([12]);
      expect(t3Changes[lkp3.id].newValue).toEqual([15]);

      // DB: T1.F=15, T2.LKP2=[15], T3.LKP3=[15]
      const t1Db = await getDbTableName(t1.id);
      const t2Db = await getDbTableName(t2.id);
      const t3Db = await getDbTableName(t3.id);
      const t1Row = await getRow(t1Db, t1.records[0].id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const t3Row = await getRow(t3Db, t3.records[0].id);
      const [f1Full] = (await getFields(t1.id)).filter((x) => x.id === (f1 as any).id) as any[];
      const [lkp2Full] = (await getFields(t2.id)).filter((x) => x.id === (lkp2 as any).id) as any[];
      const [lkp3Full] = (await getFields(t3.id)).filter((x) => x.id === (lkp3 as any).id) as any[];
      expect(parseMaybe((t1Row as any)[f1Full.dbFieldName])).toEqual(15);
      expect(parseMaybe((t2Row as any)[lkp2Full.dbFieldName])).toEqual([15]);
      expect(parseMaybe((t3Row as any)[lkp3Full.dbFieldName])).toEqual([15]);

      await permanentDeleteTable(baseId, t3.id);
      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });
  });

  // ===== Delete Field Computed Ops =====
  describe('Delete Field', () => {
    it('emits old->null for same-table formula when referenced field is deleted', async () => {
      const table = await createTable(baseId, {
        name: 'Del_Formula_SameTable',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'A', type: FieldType.Number } as IFieldRo,
        ],
        records: [{ fields: { Title: 'r1', A: 5 } }],
      });
      const aId = table.fields.find((f) => f.name === 'A')!.id;
      const f = await createField(table.id, {
        name: 'F',
        type: FieldType.Formula,
        options: { expression: `{${aId}} + 1` },
      } as IFieldRo);

      // Prime record value
      await updateRecordByApi(table.id, table.records[0].id, aId, 5);

      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        1
      )(async () => {
        await deleteField(table.id, aId);
      })) as any;

      const event = payloads[0] as any;
      expect(event.payload.tableId).toBe(table.id);
      const rec = Array.isArray(event.payload.record)
        ? event.payload.record[0]
        : event.payload.record;
      const changes = rec.fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(changes[f.id]).toBeDefined();
      expect(changes[f.id].oldValue).toEqual(6);
      expect(changes[f.id].newValue).toBeNull();

      // DB: F should be null after delete of dependency
      const dbName = await getDbTableName(table.id);
      const row = await getRow(dbName, table.records[0].id);
      const fFull = (await getFields(table.id)).find((x) => x.id === (f as any).id)! as any;
      expect((row as any)[fFull.dbFieldName]).toBeUndefined();

      await permanentDeleteTable(baseId, table.id);
    });

    it('emits old->null for multi-level formulas when base field is deleted', async () => {
      const table = await createTable(baseId, {
        name: 'Del_Multi_Formula',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'A', type: FieldType.Number } as IFieldRo,
        ],
        records: [{ fields: { Title: 'r1', A: 2 } }],
      });

      const aId = table.fields.find((f) => f.name === 'A')!.id;
      const b = await createField(table.id, {
        name: 'B',
        type: FieldType.Formula,
        options: { expression: `{${aId}} + 1` },
      } as IFieldRo);
      const c = await createField(table.id, {
        name: 'C',
        type: FieldType.Formula,
        options: { expression: `{${b.id}} * 2` },
      } as IFieldRo);

      // Prime values
      await updateRecordByApi(table.id, table.records[0].id, aId, 2);

      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        1
      )(async () => {
        await deleteField(table.id, aId);
      })) as any;

      const evt = payloads[0];
      const rec = Array.isArray(evt.payload.record) ? evt.payload.record[0] : evt.payload.record;
      const changes = rec.fields as Record<string, { oldValue: unknown; newValue: unknown }>;

      // A: 2; B: 3; C: 6 -> null after delete
      expect(changes[b.id]).toBeDefined();
      expect(changes[b.id].oldValue).toEqual(3);
      expect(changes[b.id].newValue).toBeNull();
      expect(changes[c.id]).toBeDefined();
      expect(changes[c.id].oldValue).toEqual(6);
      expect(changes[c.id].newValue).toBeNull();

      // DB: B and C should be null
      const dbName = await getDbTableName(table.id);
      const row = await getRow(dbName, table.records[0].id);
      const fields = await getFields(table.id);
      const bFull = fields.find((x) => x.id === (b as any).id)! as any;
      const cFull = fields.find((x) => x.id === (c as any).id)! as any;
      expect((row as any)[bFull.dbFieldName]).toBeUndefined();
      expect((row as any)[cFull.dbFieldName]).toBeUndefined();

      await permanentDeleteTable(baseId, table.id);
    });

    it('emits old->null for multi-level lookup when source field is deleted', async () => {
      // T1: A (number)
      const t1 = await createTable(baseId, {
        name: 'Del_Multi_Lookup_T1',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'A', type: FieldType.Number } as IFieldRo,
        ],
        records: [{ fields: { Title: 't1r1', A: 10 } }],
      });
      const aId = t1.fields.find((f) => f.name === 'A')!.id;
      await updateRecordByApi(t1.id, t1.records[0].id, aId, 10);

      // T2: link -> T1, L2 = lookup(A)
      const t2 = await createTable(baseId, {
        name: 'Del_Multi_Lookup_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const l12 = await createField(t2.id, {
        name: 'L_T1',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);
      const l2 = await createField(t2.id, {
        name: 'L2',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { foreignTableId: t1.id, linkFieldId: l12.id, lookupFieldId: aId } as any,
      } as any);
      await updateRecordByApi(t2.id, t2.records[0].id, l12.id, [{ id: t1.records[0].id }]);

      // T3: link -> T2, L3 = lookup(L2)
      const t3 = await createTable(baseId, {
        name: 'Del_Multi_Lookup_T3',
        fields: [],
        records: [{ fields: {} }],
      });
      const l23 = await createField(t3.id, {
        name: 'L_T2',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t2.id },
      } as IFieldRo);
      const l3 = await createField(t3.id, {
        name: 'L3',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { foreignTableId: t2.id, linkFieldId: l23.id, lookupFieldId: l2.id } as any,
      } as any);
      await updateRecordByApi(t3.id, t3.records[0].id, l23.id, [{ id: t2.records[0].id }]);

      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await deleteField(t1.id, aId);
      })) as any;

      // T2
      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
      const t2Changes = (
        Array.isArray(t2Event.payload.record) ? t2Event.payload.record[0] : t2Event.payload.record
      ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(t2Changes[l2.id]).toBeDefined();
      expect(t2Changes[l2.id].oldValue).toEqual([10]);
      expect(t2Changes[l2.id].newValue).toBeNull();

      // T3
      const t3Event = (payloads as any[]).find((e) => e.payload.tableId === t3.id)!;
      const t3Changes = (
        Array.isArray(t3Event.payload.record) ? t3Event.payload.record[0] : t3Event.payload.record
      ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(t3Changes[l3.id]).toBeDefined();
      expect(t3Changes[l3.id].oldValue).toEqual([10]);
      expect(t3Changes[l3.id].newValue).toBeNull();

      // DB: L2 and L3 should be null
      const t2Db = await getDbTableName(t2.id);
      const t3Db = await getDbTableName(t3.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const t3Row = await getRow(t3Db, t3.records[0].id);
      const l2Full = (await getFields(t2.id)).find((x) => x.id === (l2 as any).id)! as any;
      const l3Full = (await getFields(t3.id)).find((x) => x.id === (l3 as any).id)! as any;
      expect((t2Row as any)[l2Full.dbFieldName]).toBeNull();
      expect((t3Row as any)[l3Full.dbFieldName]).toBeNull();

      await permanentDeleteTable(baseId, t3.id);
      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('emits old->null for lookup when source field is deleted', async () => {
      // T1 with A
      const t1 = await createTable(baseId, {
        name: 'Del_Lookup_T1',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'A', type: FieldType.Number } as IFieldRo,
        ],
        records: [{ fields: { Title: 'r1', A: 10 } }],
      });
      const aId = t1.fields.find((f) => f.name === 'A')!.id;
      await updateRecordByApi(t1.id, t1.records[0].id, aId, 10);

      // T2 link -> T1 and lookup A
      const t2 = await createTable(baseId, {
        name: 'Del_Lookup_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const link = await createField(t2.id, {
        name: 'L',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);
      const lkp = await createField(t2.id, {
        name: 'LKP',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: { foreignTableId: t1.id, linkFieldId: link.id, lookupFieldId: aId } as any,
      } as any);

      await updateRecordByApi(t2.id, t2.records[0].id, link.id, [{ id: t1.records[0].id }]);

      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        1
      )(async () => {
        await deleteField(t1.id, aId);
      })) as any;

      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
      const changes = (
        Array.isArray(t2Event.payload.record) ? t2Event.payload.record[0] : t2Event.payload.record
      ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(changes[lkp.id]).toBeDefined();
      expect(changes[lkp.id].oldValue).toEqual([10]);
      expect(changes[lkp.id].newValue).toBeNull();

      // DB: LKP should be null
      const t2Db = await getDbTableName(t2.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const lkpFull = (await getFields(t2.id)).find((x) => x.id === (lkp as any).id)! as any;
      expect((t2Row as any)[lkpFull.dbFieldName]).toBeNull();

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it.skip('emits old->null for rollup when source field is deleted', async () => {
      const t1 = await createTable(baseId, {
        name: 'Del_Rollup_T1',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'A', type: FieldType.Number } as IFieldRo,
        ],
        records: [{ fields: { Title: 'r1', A: 3 } }, { fields: { Title: 'r2', A: 7 } }],
      });
      const aId = t1.fields.find((f) => f.name === 'A')!.id;
      await updateRecordByApi(t1.id, t1.records[0].id, aId, 3);
      await updateRecordByApi(t1.id, t1.records[1].id, aId, 7);

      const t2 = await createTable(baseId, {
        name: 'Del_Rollup_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const link = await createField(t2.id, {
        name: 'L_T1',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);
      const roll = await createField(t2.id, {
        name: 'R',
        type: FieldType.Rollup,
        lookupOptions: { foreignTableId: t1.id, linkFieldId: link.id, lookupFieldId: aId } as any,
        options: { expression: 'sum({values})' } as any,
      } as any);

      await updateRecordByApi(t2.id, t2.records[0].id, link.id, [
        { id: t1.records[0].id },
        { id: t1.records[1].id },
      ]);

      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        1
      )(async () => {
        await deleteField(t1.id, aId);
      })) as any;

      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
      const changes = (
        Array.isArray(t2Event.payload.record) ? t2Event.payload.record[0] : t2Event.payload.record
      ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(changes[roll.id]).toBeDefined();
      // Known follow-up: ensure rollup column participates in updateFromSelect on delete
      // expect(changes[roll.id].oldValue).toEqual(10);
      // expect(changes[roll.id].newValue).toBeNull();

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });
  });

  describe('Field Create/Update/Duplicate events', () => {
    it('create: basic field does not trigger record.update; computed fields do when refs have values', async () => {
      const table = await createTable(baseId, {
        name: 'Create_Field_Event',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 1 } }],
      });
      const aId = table.fields.find((f) => f.name === 'A')!.id;

      // Prime A
      await updateRecordByApi(table.id, table.records[0].id, aId, 1);

      // 1) basic field
      {
        const { events } = await runAndCaptureRecordUpdates(async () => {
          await createField(table.id, { name: 'B', type: FieldType.SingleLineText } as IFieldRo);
        });
        expect(events.length).toBe(0);
      }

      // 2) formula referencing A -> expect 1 update with newValue
      {
        const { events } = await runAndCaptureRecordUpdates(async () => {
          await createField(table.id, {
            name: 'F',
            type: FieldType.Formula,
            options: { expression: `{${aId}} + 1` },
          } as IFieldRo);
        });
        expect(events.length).toBe(1);
        const changeMap = (
          Array.isArray(events[0].payload.record)
            ? events[0].payload.record[0]
            : events[0].payload.record
        ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
        const fId = (await getFields(table.id)).find((f) => f.name === 'F')!.id;
        expect(changeMap[fId]).toBeDefined();
        expect(changeMap[fId].oldValue).toBeUndefined();
        expect(changeMap[fId].newValue).toEqual(2);

        // DB: F should equal 2
        const tbl = await getDbTableName(table.id);
        const row = await getRow(tbl, table.records[0].id);
        const fFull = (await getFields(table.id)).find((x) => x.id === fId)! as any;
        expect(parseMaybe((row as any)[fFull.dbFieldName])).toEqual(2);
      }

      await permanentDeleteTable(baseId, table.id);
    });

    it('create: lookup/rollup only trigger record.update when link + source values exist', async () => {
      // T1 with A=10
      const t1 = await createTable(baseId, {
        name: 'Create_LookupRollup_T1',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 10 } }],
      });
      const aId = t1.fields.find((f) => f.name === 'A')!.id;
      await updateRecordByApi(t1.id, t1.records[0].id, aId, 10);

      // T2 single record without link
      const t2 = await createTable(baseId, {
        name: 'Create_LookupRollup_T2',
        fields: [],
        records: [{ fields: {} }],
      });

      // 1) create lookup without link -> expect 0 updates
      const link = await createField(t2.id, {
        name: 'L',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);
      {
        const { events } = await runAndCaptureRecordUpdates(async () => {
          await createField(t2.id, {
            name: 'LK',
            type: FieldType.Number,
            isLookup: true,
            lookupOptions: {
              foreignTableId: t1.id,
              linkFieldId: link.id,
              lookupFieldId: aId,
            } as any,
          } as any);
        });
        expect(events.length).toBe(0);

        // DB: LK should be null when there is no link
        const t2Db = await getDbTableName(t2.id);
        const t2Row = await getRow(t2Db, t2.records[0].id);
        const lkpField = (await getFields(t2.id)).find((f) => f.name === 'LK') as any;
        expect((t2Row as any)[lkpField.dbFieldName]).toBeNull();
      }

      // Establish link and then create rollup -> expect 1 update
      await updateRecordByApi(t2.id, t2.records[0].id, link.id, [{ id: t1.records[0].id }]);
      {
        const { events } = await runAndCaptureRecordUpdates(async () => {
          await createField(t2.id, {
            name: 'R',
            type: FieldType.Rollup,
            lookupOptions: {
              foreignTableId: t1.id,
              linkFieldId: link.id,
              lookupFieldId: aId,
            } as any,
            options: { expression: 'sum({values})' } as any,
          } as any);
        });
        expect(events.length).toBe(1);
        const changeMap = (
          Array.isArray(events[0].payload.record)
            ? events[0].payload.record[0]
            : events[0].payload.record
        ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
        const rId = (await getFields(t2.id)).find((f) => f.name === 'R')!.id;
        expect(changeMap[rId]).toBeDefined();
        expect(changeMap[rId].oldValue).toBeUndefined();
        expect(changeMap[rId].newValue).toEqual(10);

        // DB: R should equal 10
        const t2Db = await getDbTableName(t2.id);
        const t2Row = await getRow(t2Db, t2.records[0].id);
        const rFull = (await getFields(t2.id)).find((f) => f.id === rId)! as any;
        expect(parseMaybe((t2Row as any)[rFull.dbFieldName])).toEqual(10);
      }

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('update(convert): changing a formula expression publishes record.update when values change', async () => {
      const table = await createTable(baseId, {
        name: 'Update_Field_Event',
        fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { A: 2 } }],
      });
      const aId = table.fields.find((f) => f.name === 'A')!.id;
      const f = await createField(table.id, {
        name: 'F',
        type: FieldType.Formula,
        options: { expression: `{${aId}}` },
      } as IFieldRo);
      await updateRecordByApi(table.id, table.records[0].id, aId, 2);

      // convert F: {A} -> {A} + 5
      const { events } = await runAndCaptureRecordUpdates(async () => {
        await convertField(table.id, f.id, {
          id: f.id,
          type: FieldType.Formula,
          name: f.name,
          options: { expression: `{${aId}} + 5` },
        } as any);
      });
      expect(events.length).toBe(1);
      const changeMap = (
        Array.isArray(events[0].payload.record)
          ? events[0].payload.record[0]
          : events[0].payload.record
      ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
      expect(changeMap[f.id]).toBeDefined();
      expect(changeMap[f.id].oldValue).toEqual(2);
      expect(changeMap[f.id].newValue).toEqual(7);

      // DB: F should be 7 after convert
      const tbl = await getDbTableName(table.id);
      const row = await getRow(tbl, table.records[0].id);
      const fFull = (await getFields(table.id)).find((x) => x.id === (f as any).id)! as any;
      expect(parseMaybe((row as any)[fFull.dbFieldName])).toEqual(7);

      await permanentDeleteTable(baseId, table.id);
    });

    it('duplicate: basic field with empty values does not trigger record.update; computed duplicate does', async () => {
      const table = await createTable(baseId, {
        name: 'Duplicate_Field_Event',
        fields: [
          { name: 'Text', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Num', type: FieldType.Number } as IFieldRo,
        ],
        records: [{ fields: { Num: 3 } }],
      });
      const numId = table.fields.find((f) => f.name === 'Num')!.id;
      await updateRecordByApi(table.id, table.records[0].id, numId, 3);

      // Duplicate Text (empty values) -> expect 0 updates
      {
        const textField = (await getFields(table.id)).find((f) => f.name === 'Text')!;
        const { events } = await runAndCaptureRecordUpdates(async () => {
          await duplicateField(table.id, textField.id, { name: 'Text_copy' });
        });
        expect(events.length).toBe(0);
      }

      // Add formula F = Num + 1; duplicate it -> expect updates for computed values
      const f = await createField(table.id, {
        name: 'F',
        type: FieldType.Formula,
        options: { expression: `{${numId}} + 1` },
      } as IFieldRo);
      {
        const { events } = await runAndCaptureRecordUpdates(async () => {
          await duplicateField(table.id, f.id, { name: 'F_copy' });
        });
        expect(events.length).toBe(1);
        const changeMap = (
          Array.isArray(events[0].payload.record)
            ? events[0].payload.record[0]
            : events[0].payload.record
        ).fields as Record<string, { oldValue: unknown; newValue: unknown }>;
        const fCopyId = (await getFields(table.id)).find((x) => x.name === 'F_copy')!.id;
        expect(changeMap[fCopyId]).toBeDefined();
        expect(changeMap[fCopyId].oldValue).toBeUndefined();
        expect(changeMap[fCopyId].newValue).toEqual(4);

        // DB: F_copy should equal 4
        const tbl = await getDbTableName(table.id);
        const row = await getRow(tbl, table.records[0].id);
        const fCopyFull = (await getFields(table.id)).find((x) => x.id === fCopyId)! as any;
        expect(parseMaybe((row as any)[fCopyFull.dbFieldName])).toEqual(4);
      }

      await permanentDeleteTable(baseId, table.id);
    });
  });

  // ===== Link related =====
  describe('Link', () => {
    it('updates link titles when source record title changes (ManyMany)', async () => {
      // T1 with title
      const t1 = await createTable(baseId, {
        name: 'LinkTitle_T1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'Foo' } }],
      });
      const titleId = t1.fields.find((f) => f.name === 'Title')!.id;

      // T2 link -> T1
      const t2 = await createTable(baseId, {
        name: 'LinkTitle_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const link2 = await createField(t2.id, {
        name: 'L_T1',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);

      // Establish link value
      await updateRecordByApi(t2.id, t2.records[0].id, link2.id, [{ id: t1.records[0].id }]);

      // Change title in T1, expect T2 link cell title updated in event
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t1.id, t1.records[0].id, titleId, 'Bar');
      })) as any;

      // Find T2 event
      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
      const changes = t2Event.payload.record.fields as Record<
        string,
        { oldValue: any; newValue: any }
      >;
      expect(changes[link2.id]).toBeDefined();
      expect([changes[link2.id].oldValue]?.flat()?.[0]?.title).toEqual('Foo');
      expect([changes[link2.id].newValue]?.flat()?.[0]?.title).toEqual('Bar');

      // DB: link cell title should be updated to 'Bar'
      const t2Db = await getDbTableName(t2.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const link2Full = (await getFields(t2.id)).find((f) => f.id === (link2 as any).id)! as any;
      const linkCell = parseMaybe((t2Row as any)[link2Full.dbFieldName]) as any[] | undefined;
      expect([linkCell]?.flat()?.[0]?.title).toEqual('Bar');

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('bidirectional link add/remove reflects on counterpart (multi-select)', async () => {
      // T1 with title, two records
      const t1 = await createTable(baseId, {
        name: 'BiLink_T1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'A' } }, { fields: { Title: 'B' } }],
      });

      // T2 link -> T1
      const t2 = await createTable(baseId, {
        name: 'BiLink_T2',
        fields: [],
        records: [{ fields: {} }],
      });
      const link2 = await createField(t2.id, {
        name: 'L_T1',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t1.id },
      } as IFieldRo);

      const r1 = t1.records[0].id;
      const r2 = t1.records[1].id;
      const t2r = t2.records[0].id;

      // Initially set link to [r1]
      await updateRecordByApi(t2.id, t2r, link2.id, [{ id: r1 }]);

      // Add r2: expect two updates (T2 link; T1[r2] symmetric)
      await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t2.id, t2r, link2.id, [{ id: r1 }, { id: r2 }]);
      });

      // Remove r1: expect two updates (T2 link; T1[r1] symmetric)
      await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t2.id, t2r, link2.id, [{ id: r2 }]);
      });

      // Verify symmetric link fields on T1 via field discovery
      const t1Fields = await getFields(t1.id);
      const symOnT1 = t1Fields.find(
        (f) => f.type === FieldType.Link && (f as any).options?.foreignTableId === t2.id
      )!;
      expect(symOnT1).toBeDefined();

      // After removal, r1 should not link back; r2 should link back to T2r
      // Use events already asserted for presence; here we could also fetch records if needed.

      // DB: verify physical link columns
      const t2Db = await getDbTableName(t2.id);
      const t1Db = await getDbTableName(t1.id);
      const t2Row = await getRow(t2Db, t2r);
      const link2Full = (await getFields(t2.id)).find((f) => f.id === (link2 as any).id)! as any;
      const t2LinkIds = ((parseMaybe((t2Row as any)[link2Full.dbFieldName]) as any[]) || []).map(
        (x: any) => x?.id
      );
      expect(t2LinkIds).toEqual([r2]);

      const r1Row = await getRow(t1Db, r1);
      const r2Row = await getRow(t1Db, r2);
      const symFull = symOnT1 as any;
      const r1Sym = (parseMaybe((r1Row as any)[symFull.dbFieldName]) as any[]) || [];
      const r2SymIds = ((parseMaybe((r2Row as any)[symFull.dbFieldName]) as any[]) || []).map(
        (x: any) => x?.id
      );
      expect(r1Sym.length).toBe(0);
      expect(r2SymIds).toEqual([t2r]);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('ManyMany bidirectional link: set 1-1 -> 2-1 emits two ops with empty oldValue', async () => {
      // T1 with title and 3 records: 1-1, 1-2, 1-3
      const t1 = await createTable(baseId, {
        name: 'MM_Bidir_T1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { Title: '1-1' } },
          { fields: { Title: '1-2' } },
          { fields: { Title: '1-3' } },
        ],
      });

      // T2 with title and 3 records: 2-1, 2-2, 2-3
      const t2 = await createTable(baseId, {
        name: 'MM_Bidir_T2',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { Title: '2-1' } },
          { fields: { Title: '2-2' } },
          { fields: { Title: '2-3' } },
        ],
      });

      // Create link on T1 -> T2 (ManyMany). This also creates symmetric link on T2 -> T1
      const linkOnT1 = await createField(t1.id, {
        name: 'Link_T2',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t2.id },
      } as IFieldRo);

      // Find symmetric link field id on T2 -> T1
      const t2Fields = await getFields(t2.id);
      const linkOnT2 = t2Fields.find(
        (ff) => ff.type === FieldType.Link && (ff as any).options?.foreignTableId === t1.id
      )!;

      const r1_1 = t1.records[0].id; // 1-1
      const r2_1 = t2.records[0].id; // 2-1

      // Perform: set T1[1-1].Link_T2 = [2-1]
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t1.id, r1_1, linkOnT1.id, [{ id: r2_1 }]);
      })) as any;

      // Helper to normalize array-ish values
      const norm = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      const idsOf = (v: any) =>
        norm(v)
          .map((x: any) => x?.id)
          .filter(Boolean);

      // Expect: one event on T1[1-1] and one symmetric event on T2[2-1]
      const t1Event = (payloads as any[]).find((e) => e.payload.tableId === t1.id)!;
      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;

      // Assert T1 event: linkOnT1 oldValue empty -> newValue [2-1]
      const t1Changes = t1Event.payload.record.fields as Record<
        string,
        { oldValue: any; newValue: any }
      >;
      expect(t1Changes[linkOnT1.id]).toBeDefined();
      expect(norm(t1Changes[linkOnT1.id].oldValue).length).toBe(0);
      expect(new Set(idsOf(t1Changes[linkOnT1.id].newValue))).toEqual(new Set([r2_1]));

      // Assert T2 event: symmetric link oldValue empty -> newValue [1-1]
      const t2Changes = t2Event.payload.record.fields as Record<
        string,
        { oldValue: any; newValue: any }
      >;
      expect(t2Changes[linkOnT2.id]).toBeDefined();
      expect(norm(t2Changes[linkOnT2.id].oldValue).length).toBe(0);
      expect(new Set(idsOf(t2Changes[linkOnT2.id].newValue))).toEqual(new Set([r1_1]));

      // DB: verify both sides persisted
      const t1Db = await getDbTableName(t1.id);
      const t2Db = await getDbTableName(t2.id);
      const t1Row = await getRow(t1Db, r1_1);
      const t2Row = await getRow(t2Db, r2_1);
      const linkOnT1Full = (await getFields(t1.id)).find(
        (f) => f.id === (linkOnT1 as any).id
      )! as any;
      const linkOnT2Full = (await getFields(t2.id)).find(
        (f) => f.id === (linkOnT2 as any).id
      )! as any;
      const t1Ids = ((parseMaybe((t1Row as any)[linkOnT1Full.dbFieldName]) as any[]) || []).map(
        (x: any) => x?.id
      );
      const t2Ids = ((parseMaybe((t2Row as any)[linkOnT2Full.dbFieldName]) as any[]) || []).map(
        (x: any) => x?.id
      );
      expect(t1Ids).toEqual([r2_1]);
      expect(t2Ids).toEqual([r1_1]);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('ManyMany multi-select: add and remove items trigger symmetric old/new on target rows', async () => {
      // T1 with title and 1 record: A1
      const t1 = await createTable(baseId, {
        name: 'MM_AddRemove_T1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'A1' } }],
      });

      // T2 with title and 2 records: B1, B2
      const t2 = await createTable(baseId, {
        name: 'MM_AddRemove_T2',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'B1' } }, { fields: { Title: 'B2' } }],
      });

      const linkOnT1 = await createField(t1.id, {
        name: 'L_T2',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t2.id },
      } as IFieldRo);

      const t2Fields = await getFields(t2.id);
      const linkOnT2 = t2Fields.find(
        (ff) => ff.type === FieldType.Link && (ff as any).options?.foreignTableId === t1.id
      )!;

      const norm = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      const idsOf = (v: any) =>
        norm(v)
          .map((x: any) => x?.id)
          .filter(Boolean);

      const rA1 = t1.records[0].id;
      const rB1 = t2.records[0].id;
      const rB2 = t2.records[1].id;

      const getChangeFromEvent = (
        evt: any,
        linkFieldId: string,
        recordId?: string
      ): { oldValue: any; newValue: any } | undefined => {
        const recs = Array.isArray(evt.payload.record) ? evt.payload.record : [evt.payload.record];
        const target = recordId ? recs.find((r: any) => r.id === recordId) : recs[0];
        return target?.fields?.[linkFieldId];
      };

      // Step 1: set T1[A1] = [B1]; expect symmetric event on T2[B1]
      {
        const { payloads } = (await createAwaitWithEventWithResultWithCount(
          eventEmitterService,
          Events.TABLE_RECORD_UPDATE,
          2
        )(async () => {
          await updateRecordByApi(t1.id, rA1, linkOnT1.id, [{ id: rB1 }]);
        })) as any;

        const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
        const change = getChangeFromEvent(t2Event, linkOnT2.id, rB1)!;
        expect(change).toBeDefined();
        expect(norm(change.oldValue).length).toBe(0);
        expect(new Set(idsOf(change.newValue))).toEqual(new Set([rA1]));
      }

      // Step 2: add B2 -> [B1, B2]; expect symmetric event for T2[B2]
      {
        const { payloads } = (await createAwaitWithEventWithResultWithCount(
          eventEmitterService,
          Events.TABLE_RECORD_UPDATE,
          2
        )(async () => {
          await updateRecordByApi(t1.id, rA1, linkOnT1.id, [{ id: rB1 }, { id: rB2 }]);
        })) as any;

        const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
        const change = getChangeFromEvent(t2Event, linkOnT2.id, rB2)!;
        expect(change).toBeDefined();
        expect(norm(change.oldValue).length).toBe(0);
        expect(new Set(idsOf(change.newValue))).toEqual(new Set([rA1]));
      }

      // Step 3: remove B1 -> [B2]; expect symmetric removal event on T2[B1]
      {
        const { payloads } = (await createAwaitWithEventWithResultWithCount(
          eventEmitterService,
          Events.TABLE_RECORD_UPDATE,
          2
        )(async () => {
          await updateRecordByApi(t1.id, rA1, linkOnT1.id, [{ id: rB2 }]);
        })) as any;

        const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
        const change =
          getChangeFromEvent(t2Event, linkOnT2.id, rB1) || getChangeFromEvent(t2Event, linkOnT2.id);
        expect(change).toBeDefined();
        expect(new Set(idsOf(change!.oldValue))).toEqual(new Set([rA1]));
        expect(norm(change!.newValue).length).toBe(0);
      }

      // DB: final state T1[A1] -> [B2] and symmetric T2[B2] -> [A1]
      const t1Db = await getDbTableName(t1.id);
      const t2Db = await getDbTableName(t2.id);
      const t1Row = await getRow(t1Db, rA1);
      const t2RowB2 = await getRow(t2Db, rB2);
      const linkOnT1Full = (await getFields(t1.id)).find(
        (f) => f.id === (linkOnT1 as any).id
      )! as any;
      const linkOnT2Full = (await getFields(t2.id)).find(
        (f) => f.id === (linkOnT2 as any).id
      )! as any;
      const t1Ids = ((parseMaybe((t1Row as any)[linkOnT1Full.dbFieldName]) as any[]) || []).map(
        (x: any) => x?.id
      );
      const t2Ids = ((parseMaybe((t2RowB2 as any)[linkOnT2Full.dbFieldName]) as any[]) || []).map(
        (x: any) => x?.id
      );
      expect(t1Ids).toEqual([rB2]);
      expect(t2Ids).toEqual([rA1]);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('ManyOne single-select: add and switch target emit symmetric add/remove with correct old/new', async () => {
      // T1: many→one (single link)
      const t1 = await createTable(baseId, {
        name: 'M1_S_T1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'A1' } }],
      });
      const t2 = await createTable(baseId, {
        name: 'M1_S_T2',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'B1' } }, { fields: { Title: 'B2' } }],
      });
      const linkOnT1 = await createField(t1.id, {
        name: 'L_T2_M1',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyOne, foreignTableId: t2.id },
      } as IFieldRo);
      const t2Fields = await getFields(t2.id);
      const linkOnT2 = t2Fields.find(
        (ff) => ff.type === FieldType.Link && (ff as any).options?.foreignTableId === t1.id
      )!;

      const norm = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      const idsOf = (v: any) =>
        norm(v)
          .map((x: any) => x?.id)
          .filter(Boolean);

      const rA1 = t1.records[0].id;
      const rB1 = t2.records[0].id;
      const rB2 = t2.records[1].id;

      // Set A1 -> B1
      {
        const { payloads } = (await createAwaitWithEventWithResultWithCount(
          eventEmitterService,
          Events.TABLE_RECORD_UPDATE,
          2
        )(async () => {
          await updateRecordByApi(t1.id, rA1, linkOnT1.id, { id: rB1 });
        })) as any;
        const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
        const recs = Array.isArray(t2Event.payload.record)
          ? t2Event.payload.record
          : [t2Event.payload.record];
        const change = recs.find((r: any) => r.id === rB1)?.fields?.[linkOnT2.id] as
          | { oldValue: any; newValue: any }
          | undefined;
        expect(change).toBeDefined();
        expect(norm(change!.oldValue).length).toBe(0);
        expect(new Set(idsOf(change!.newValue))).toEqual(new Set([rA1]));
      }

      // Switch A1 -> B2 (removes from B1, adds to B2)
      {
        const { payloads } = (await createAwaitWithEventWithResultWithCount(
          eventEmitterService,
          Events.TABLE_RECORD_UPDATE,
          2
        )(async () => {
          await updateRecordByApi(t1.id, rA1, linkOnT1.id, { id: rB2 });
        })) as any;
        const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
        const recs = Array.isArray(t2Event.payload.record)
          ? t2Event.payload.record
          : [t2Event.payload.record];
        const changeB1 =
          recs.find((r: any) => r.id === rB1)?.fields?.[linkOnT2.id] ||
          recs.find((r: any) => new Set(idsOf(r?.fields?.[linkOnT2.id]?.oldValue)).has(rA1))
            ?.fields?.[linkOnT2.id];
        expect(changeB1).toBeDefined();
        // removal from B1
        expect(new Set(idsOf(changeB1!.oldValue))).toEqual(new Set([rA1]));
        expect(norm(changeB1!.newValue).length).toBe(0);
      }

      // DB: final state T1[A1] -> {id: B2} and symmetric on T2
      const t1Db = await getDbTableName(t1.id);
      const t2Db = await getDbTableName(t2.id);
      const t1Row = await getRow(t1Db, rA1);
      const t2RowB1 = await getRow(t2Db, rB1);
      const t2RowB2 = await getRow(t2Db, rB2);
      const linkOnT1Full = (await getFields(t1.id)).find(
        (f) => f.id === (linkOnT1 as any).id
      )! as any;
      const linkOnT2Full = (await getFields(t2.id)).find(
        (f) => f.id === (linkOnT2 as any).id
      )! as any;
      const t1Val = parseMaybe((t1Row as any)[linkOnT1Full.dbFieldName]) as any[] | any | null;
      const b1Val = parseMaybe((t2RowB1 as any)[linkOnT2Full.dbFieldName]) as any[] | any | null;
      const b2Val = parseMaybe((t2RowB2 as any)[linkOnT2Full.dbFieldName]) as any[] | any | null;
      const asArr = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      expect(asArr(t1Val).map((x) => x?.id)).toEqual([rB2]);
      expect(asArr(b1Val).length).toBe(0);
      expect(asArr(b2Val).map((x) => x?.id)).toEqual([rA1]);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('OneMany multi-select: add/remove items emit symmetric single-link old/new on foreign rows', async () => {
      // T1: one→many (multi link on source)
      const t1 = await createTable(baseId, {
        name: '1M_M_T1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'A1' } }],
      });
      const t2 = await createTable(baseId, {
        name: '1M_M_T2',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'B1' } }, { fields: { Title: 'B2' } }],
      });
      const linkOnT1 = await createField(t1.id, {
        name: 'L_T2_1M',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: t2.id },
      } as IFieldRo);
      const t2Fields = await getFields(t2.id);
      const linkOnT2 = t2Fields.find(
        (ff) => ff.type === FieldType.Link && (ff as any).options?.foreignTableId === t1.id
      )!;

      const rA1 = t1.records[0].id;
      const rB1 = t2.records[0].id;
      const rB2 = t2.records[1].id;

      // Set [B1]
      {
        const { payloads } = (await createAwaitWithEventWithResultWithCount(
          eventEmitterService,
          Events.TABLE_RECORD_UPDATE,
          2
        )(async () => {
          await updateRecordByApi(t1.id, rA1, linkOnT1.id, [{ id: rB1 }]);
        })) as any;
        const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
        const recs = Array.isArray(t2Event.payload.record)
          ? t2Event.payload.record
          : [t2Event.payload.record];
        const change = recs.find((r: any) => r.id === rB1)?.fields?.[linkOnT2.id] as
          | { oldValue: any; newValue: any }
          | undefined;
        expect(change).toBeDefined();
        expect(change!.oldValue == null).toBe(true);
        expect(change!.newValue?.id).toBe(rA1);
      }

      // Add B2 -> [B1, B2]; expect symmetric add on B2
      {
        const { payloads } = (await createAwaitWithEventWithResultWithCount(
          eventEmitterService,
          Events.TABLE_RECORD_UPDATE,
          2
        )(async () => {
          await updateRecordByApi(t1.id, rA1, linkOnT1.id, [{ id: rB1 }, { id: rB2 }]);
        })) as any;
        const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
        const recs = Array.isArray(t2Event.payload.record)
          ? t2Event.payload.record
          : [t2Event.payload.record];
        const change = recs.find((r: any) => r.id === rB2)?.fields?.[linkOnT2.id] as
          | { oldValue: any; newValue: any }
          | undefined;
        expect(change).toBeDefined();
        expect(change!.oldValue == null).toBe(true);
        expect(change!.newValue?.id).toBe(rA1);
      }

      // Remove B1 -> [B2]; expect symmetric removal on B1
      {
        const { payloads } = (await createAwaitWithEventWithResultWithCount(
          eventEmitterService,
          Events.TABLE_RECORD_UPDATE,
          2
        )(async () => {
          await updateRecordByApi(t1.id, rA1, linkOnT1.id, [{ id: rB2 }]);
        })) as any;
        const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
        const recs = Array.isArray(t2Event.payload.record)
          ? t2Event.payload.record
          : [t2Event.payload.record];
        const change =
          recs.find((r: any) => r.id === rB1)?.fields?.[linkOnT2.id] ||
          recs.find((r: any) => r?.fields?.[linkOnT2.id]?.oldValue?.id === rA1)?.fields?.[
            linkOnT2.id
          ];
        expect(change).toBeDefined();
        expect(change!.oldValue?.id).toBe(rA1);
        expect(change!.newValue).toBeNull();
      }

      // DB: final state T1[A1] -> [B2] and symmetric T2[B2] -> {id: A1}
      const t1Db = await getDbTableName(t1.id);
      const t2Db = await getDbTableName(t2.id);
      const t1Row = await getRow(t1Db, rA1);
      const t2RowB1 = await getRow(t2Db, rB1);
      const t2RowB2 = await getRow(t2Db, rB2);
      const linkOnT1Full = (await getFields(t1.id)).find(
        (f) => f.id === (linkOnT1 as any).id
      )! as any;
      const linkOnT2Full = (await getFields(t2.id)).find(
        (f) => f.id === (linkOnT2 as any).id
      )! as any;
      const t1Ids = ((parseMaybe((t1Row as any)[linkOnT1Full.dbFieldName]) as any[]) || []).map(
        (x: any) => x?.id
      );
      const b1Val = parseMaybe((t2RowB1 as any)[linkOnT2Full.dbFieldName]) as any[] | any | null;
      const b2Val = parseMaybe((t2RowB2 as any)[linkOnT2Full.dbFieldName]) as any[] | any | null;
      const asArr = (v: any) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      expect(t1Ids).toEqual([rB2]);
      expect(asArr(b1Val).length).toBe(0);
      expect(asArr(b2Val).map((x) => x?.id)).toEqual([rA1]);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('ManyMany: removing unrelated item should not emit event for unchanged counterpart', async () => {
      // T1 with two records: 1-1, 1-2
      const t1 = await createTable(baseId, {
        name: 'MM_NoChange_T1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: '1-1' } }, { fields: { Title: '1-2' } }],
      });
      // T2 with one record: 2-1
      const t2 = await createTable(baseId, {
        name: 'MM_NoChange_T2',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: '2-1' } }],
      });

      // Create ManyMany link on T1 -> T2; symmetric generated on T2
      const linkOnT1 = await createField(t1.id, {
        name: 'L_T2_MM',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyMany, foreignTableId: t2.id },
      } as IFieldRo);
      const t2Fields = await getFields(t2.id);
      const linkOnT2 = t2Fields.find(
        (ff) => ff.type === FieldType.Link && (ff as any).options?.foreignTableId === t1.id
      )!;

      const r1_1 = t1.records[0].id;
      const r1_2 = t1.records[1].id;
      const r2_1 = t2.records[0].id;

      // 1) Establish mutual link 1-1 <-> 2-1
      await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t1.id, r1_1, linkOnT1.id, [{ id: r2_1 }]);
      });

      // 2) Add 1-2 to 2-1, now 2-1 links [1-1, 1-2]
      await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t2.id, r2_1, linkOnT2.id, [{ id: r1_1 }, { id: r1_2 }]);
      });

      // 3) Remove 1-2, keep only 1-1; expect:
      //    - T2[2-1] changed
      //    - T1[1-2] changed (removed)
      //    - T1[1-1] unchanged => SHOULD NOT have a change entry
      const { payloads } = (await createAwaitWithEventWithResultWithCount(
        eventEmitterService,
        Events.TABLE_RECORD_UPDATE,
        2
      )(async () => {
        await updateRecordByApi(t2.id, r2_1, linkOnT2.id, [{ id: r1_1 }]);
      })) as any;

      const t1Event = (payloads as any[]).find((e) => e.payload.tableId === t1.id)!;
      const recs = Array.isArray(t1Event.payload.record)
        ? t1Event.payload.record
        : [t1Event.payload.record];

      const changeOn11 = recs.find((r: any) => r.id === r1_1)?.fields?.[linkOnT1.id];
      const changeOn12 = recs.find((r: any) => r.id === r1_2)?.fields?.[linkOnT1.id];

      expect(changeOn12).toBeDefined(); // 1-2 removed 2-1
      expect(changeOn11).toBeUndefined(); // 1-1 unchanged should not have event

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });
  });
});
