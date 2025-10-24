/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFilter,
  IFilterItem,
  ILinkFieldOptions,
  ILookupOptionsRo,
} from '@teable/core';
import {
  FieldType,
  Relationship,
  FieldKeyType,
  is as FilterOperatorIs,
  isGreater as FilterOperatorIsGreater,
  isNotEmpty as FilterOperatorIsNotEmpty,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { duplicateField, convertField } from '@teable/openapi';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
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
  createRecords,
  getFields,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
  getRecord,
} from './utils/init-app';

dayjs.extend(utc);
dayjs.extend(timezone);

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
      await new Promise((r) => setTimeout(r, 50));
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

  type FieldChangePayload = { oldValue: any; newValue: any };
  type FieldChangeMap = Record<string, FieldChangePayload>;

  const assertChange = (change: FieldChangePayload | undefined): FieldChangePayload => {
    expect(change).toBeDefined();
    return change!;
  };

  const expectNoOldValue = (change: FieldChangePayload) => {
    expect(change.oldValue === null || change.oldValue === undefined).toBe(true);
  };

  const toChangeMap = (event: any): FieldChangeMap => {
    const recordPayload = Array.isArray(event.payload.record)
      ? event.payload.record[0]
      : event.payload.record;
    return (recordPayload?.fields ?? {}) as FieldChangeMap;
  };

  const findRecordChangeMap = (
    events: any[],
    tableId: string,
    recordId: string
  ): FieldChangeMap | undefined => {
    for (const event of events) {
      if (!event?.payload || event.payload.tableId !== tableId) continue;
      const recordPayloads = Array.isArray(event.payload.record)
        ? event.payload.record
        : [event.payload.record];
      for (const rec of recordPayloads) {
        if (rec?.id === recordId) {
          return (rec.fields ?? {}) as FieldChangeMap;
        }
      }
    }
    return undefined;
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
      const f1Change = assertChange(changes[f1.id]);
      expectNoOldValue(f1Change);
      expect(f1Change.newValue).toEqual(2);

      // Assert physical column for formula (non-generated) reflects new value
      const tblName = await getDbTableName(table.id);
      const row = await getRow(tblName, table.records[0].id);
      const f1Full = (await getFields(table.id)).find((f) => f.id === (f1 as any).id)! as any;
      expect(parseMaybe((row as any)[f1Full.dbFieldName])).toEqual(2);

      await permanentDeleteTable(baseId, table.id);
    });

    it('Formula unchanged publishes computed value with empty oldValue', async () => {
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
      const change = recs[0]?.fields?.[f.id] as FieldChangePayload | undefined;
      const formulaChange = assertChange(change);
      expectNoOldValue(formulaChange);
      expect(formulaChange.newValue).toEqual(1);

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
      const changes = rec.fields as FieldChangeMap;

      // A: 2 -> 3, so B: 3 -> 4, C: 6 -> 8, D: 4 -> 5
      const bChange = assertChange(changes[b.id]);
      expectNoOldValue(bChange);
      expect(bChange.newValue).toEqual(4);

      const cChange = assertChange(changes[c.id]);
      expectNoOldValue(cChange);
      expect(cChange.newValue).toEqual(8);

      const dChange = assertChange(changes[d.id]);
      expectNoOldValue(dChange);
      expect(dChange.newValue).toEqual(5);

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

    it('persists multi-value date lookup formulas without timezone cast regressions', async () => {
      const parent = await createTable(baseId, { name: 'Formula_Lookup_Parent', fields: [] });
      const child = await createTable(baseId, { name: 'Formula_Lookup_Child', fields: [] });

      try {
        const childDateField = await createField(child.id, {
          name: 'Session Time',
          type: FieldType.Date,
        } as IFieldRo);

        const linkField = await createField(parent.id, {
          name: 'Sessions',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: child.id,
          } as ILinkFieldOptions,
        } as IFieldRo);

        const symmetricFieldId = (linkField.options as ILinkFieldOptions)
          .symmetricFieldId as string;

        const lookupField = await createField(parent.id, {
          name: 'All Session Times',
          type: FieldType.Date,
          isLookup: true,
          lookupOptions: {
            foreignTableId: child.id,
            linkFieldId: linkField.id,
            lookupFieldId: childDateField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const formulaField = await createField(parent.id, {
          name: 'Follow Up Session',
          type: FieldType.Formula,
          options: {
            expression: `DATE_ADD({${lookupField.id}}, 14, 'day')`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const parentRecord = await createRecords(parent.id, { records: [{ fields: {} }] });
        const parentRecordId = parentRecord.records[0].id;

        const childRecord = await createRecords(child.id, {
          typecast: true,
          records: [
            {
              fields: {
                [childDateField.id]: '2024-01-01T00:00:00.000Z',
                [symmetricFieldId]: { id: parentRecordId },
              },
            },
          ],
        });
        const childRecordId = childRecord.records[0].id;

        // Ensure parent link field references the child so lookup returns multi-value array
        await updateRecordByApi(parent.id, parentRecordId, linkField.id, [{ id: childRecordId }]);

        const persistedParent = await getRecord(parent.id, parentRecordId);
        const followUpValue = persistedParent.fields?.[formulaField.id];
        expect(followUpValue).toBeTruthy();
        const followUpTz = dayjs(followUpValue as string).tz('Asia/Shanghai');

        const baseLookupRaw = persistedParent.fields?.[lookupField.id];
        const baseIso =
          typeof baseLookupRaw === 'string'
            ? baseLookupRaw
            : Array.isArray(baseLookupRaw)
              ? (baseLookupRaw[0] as string | undefined)
              : undefined;
        expect(baseIso).toBeTruthy();
        const baseTz = dayjs(baseIso as string).tz('Asia/Shanghai');

        expect(followUpTz.diff(baseTz, 'day')).toBe(14);
      } finally {
        await permanentDeleteTable(baseId, child.id);
        await permanentDeleteTable(baseId, parent.id);
      }
    });

    it('handles divide and modulo by zero during computed persistence', async () => {
      const table = await createTable(baseId, { name: 'Formula_Divide_Zero', fields: [] });

      try {
        const numeratorField = await createField(table.id, {
          name: 'Numerator',
          type: FieldType.Number,
        } as IFieldRo);
        const denominatorField = await createField(table.id, {
          name: 'Denominator',
          type: FieldType.Number,
        } as IFieldRo);

        const ratioField = await createField(table.id, {
          name: 'Ratio',
          type: FieldType.Formula,
          options: { expression: `{${numeratorField.id}} / {${denominatorField.id}}` },
        } as IFieldRo);

        const remainderField = await createField(table.id, {
          name: 'Remainder',
          type: FieldType.Formula,
          options: { expression: `{${numeratorField.id}} % {${denominatorField.id}}` },
        } as IFieldRo);

        const created = await createRecords(table.id, {
          records: [
            {
              fields: {
                [numeratorField.id]: 10,
                [denominatorField.id]: 0,
              },
            },
          ],
        });
        const recordId = created.records[0].id;

        const record = await getRecord(table.id, recordId);
        expect(record.fields?.[ratioField.id] ?? null).toBeNull();
        expect(record.fields?.[remainderField.id] ?? null).toBeNull();
      } finally {
        await permanentDeleteTable(baseId, table.id);
      }
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
      const changes = rec.fields as FieldChangeMap;
      const lkpChange = assertChange(changes[lkp.id]);
      expectNoOldValue(lkpChange);
      expect(lkpChange.newValue).toEqual(456);

      const t2Db = await getDbTableName(t2.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const lkpFull = (await getFields(t2.id)).find((f) => f.id === (lkp as any).id)! as any;
      expect(parseMaybe((t2Row as any)[lkpFull.dbFieldName])).toEqual(456);

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });

    it('post-convert (one-way -> two-way) persists symmetric link values on foreign table', async () => {
      // T1 with title and one record
      const t1 = await createTable(baseId, {
        name: 'Conv_OW_TO_TW_T1',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'A1' } }],
      });

      // T2 with title and one record
      const t2 = await createTable(baseId, {
        name: 'Conv_OW_TO_TW_T2',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'B1' } }],
      });

      // Create a one-way OneMany link on T1 -> T2
      const linkOnT1 = await createField(t1.id, {
        name: 'L_T2_OM_OW',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: t2.id, isOneWay: true },
      } as IFieldRo);

      // Set T1[A1].L_T2_OM_OW = [T2[B1]]
      await updateRecordByApi(t1.id, t1.records[0].id, linkOnT1.id, [{ id: t2.records[0].id }]);

      // Convert link to two-way (still OneMany) and capture record.update events
      const { events, result: newFieldVo } = await runAndCaptureRecordUpdates(async () => {
        return await convertField(t1.id, linkOnT1.id, {
          id: linkOnT1.id,
          type: FieldType.Link,
          name: 'L_T2_OM_TW',
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: t2.id,
            isOneWay: false,
          },
        } as any);
      });

      // Should have created a symmetric field on T2; resolve it by discovery
      const t2FieldsAfter = await getFields(t2.id);
      const symmetric = t2FieldsAfter.find(
        (ff) => ff.type === FieldType.Link && (ff as any).options?.foreignTableId === t1.id
      )!;
      const symmetricFieldId = symmetric.id;

      const evtOnT2 = events.find((e) => e.payload?.tableId === t2.id);
      expect(evtOnT2).toBeDefined();
      const recT2 = Array.isArray(evtOnT2!.payload.record)
        ? evtOnT2!.payload.record.find((r: any) => r.id === t2.records[0].id)
        : evtOnT2!.payload.record;
      const changeOnT2 = recT2.fields?.[symmetricFieldId!];
      expect(changeOnT2).toBeDefined();
      expect(
        changeOnT2.newValue?.id ||
          (Array.isArray(changeOnT2.newValue) ? changeOnT2.newValue[0]?.id : undefined)
      ).toBe(t1.records[0].id);

      // DB: the symmetric physical column on T2[B1] should be populated with {id: A1}
      const t2Db = await getDbTableName(t2.id);
      const t2Row = await getRow(t2Db, t2.records[0].id);
      const symField = (await getFields(t2.id)).find((f) => f.id === symmetricFieldId)! as any;
      const rawVal = (t2Row as any)[symField.dbFieldName];
      const parsed = parseMaybe(rawVal);
      const asObj = Array.isArray(parsed) ? parsed[0] : parsed;
      expect(asObj?.id).toBe(t1.records[0].id);

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
      const changes = rec.fields as FieldChangeMap;
      const lkpChange = assertChange(changes[lkp.id]);
      expectNoOldValue(lkpChange);
      expect(lkpChange.newValue).toEqual([123]);

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
      const changes = rec.fields as FieldChangeMap;
      const lkpChange = assertChange(changes[lkp.id]);
      expectNoOldValue(lkpChange);
      expect(lkpChange.newValue).toBeNull();

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
      const changes = rec.fields as FieldChangeMap;
      const lkpChange = assertChange(changes[lkp.id]);
      expectNoOldValue(lkpChange);
      expect(lkpChange.newValue).toEqual([7]);

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
      const lkpChange = assertChange(changes[lkp2.id]);
      expectNoOldValue(lkpChange);
      expect(lkpChange.newValue).toEqual([20]);

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
      const rollChange = assertChange(changes[roll2.id]);
      expectNoOldValue(rollChange);
      expect(rollChange.newValue).toEqual(11);

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
      ).fields as FieldChangeMap;
      const t1Change = assertChange(t1Changes[f1.id]);
      expectNoOldValue(t1Change);
      expect(t1Change.newValue).toEqual(15);

      // T2
      const t2Event = (payloads as any[]).find((e) => e.payload.tableId === t2.id)!;
      const t2Changes = (
        Array.isArray(t2Event.payload.record) ? t2Event.payload.record[0] : t2Event.payload.record
      ).fields as FieldChangeMap;
      const t2Change = assertChange(t2Changes[lkp2.id]);
      expectNoOldValue(t2Change);
      expect(t2Change.newValue).toEqual([15]);

      // T3
      const t3Event = (payloads as any[]).find((e) => e.payload.tableId === t3.id)!;
      const t3Changes = (
        Array.isArray(t3Event.payload.record) ? t3Event.payload.record[0] : t3Event.payload.record
      ).fields as FieldChangeMap;
      const t3Change = assertChange(t3Changes[lkp3.id]);
      expectNoOldValue(t3Change);
      expect(t3Change.newValue).toEqual([15]);

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

  // ===== Conditional Rollup =====
  describe('Conditional Rollup', () => {
    it('reacts to foreign filter and lookup column changes', async () => {
      const foreign = await createTable(baseId, {
        name: 'RefLookup_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Note', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'r1', Status: 'include', Note: 'alpha' } },
          { fields: { Title: 'r2', Status: 'exclude', Note: 'beta' } },
        ],
      });
      const titleId = foreign.fields.find((f) => f.name === 'Title')!.id;
      const statusId = foreign.fields.find((f) => f.name === 'Status')!.id;

      const host = await createTable(baseId, {
        name: 'RefLookup_Host',
        fields: [],
        records: [{ fields: {} }],
      });

      const filter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: 'include',
          },
        ],
      } as any;

      const { result: conditionalRollupField, events: creationEvents } =
        await runAndCaptureRecordUpdates(async () => {
          return await createField(host.id, {
            name: 'Ref Count',
            type: FieldType.ConditionalRollup,
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: titleId,
              expression: 'count({values})',
              filter,
            },
          } as IFieldRo);
        });

      const hostCreateEvent = creationEvents.find((e) => e.payload.tableId === host.id);
      expect(hostCreateEvent).toBeDefined();
      const createRecordPayload = Array.isArray(hostCreateEvent!.payload.record)
        ? hostCreateEvent!.payload.record[0]
        : hostCreateEvent!.payload.record;
      const createChanges = createRecordPayload.fields as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(createChanges[conditionalRollupField.id]).toBeDefined();
      expect(createChanges[conditionalRollupField.id].newValue).toEqual(1);

      const referenceEdges = await prisma.reference.findMany({
        where: { toFieldId: conditionalRollupField.id },
        select: { fromFieldId: true },
      });
      expect(referenceEdges.map((edge) => edge.fromFieldId)).toEqual(
        expect.arrayContaining([titleId, statusId])
      );

      const hostDbTable = await getDbTableName(host.id);
      const hostFieldVo = (await getFields(host.id)).find(
        (f) => f.id === conditionalRollupField.id
      )! as any;
      expect(
        parseMaybe((await getRow(hostDbTable, host.records[0].id))[hostFieldVo.dbFieldName])
      ).toEqual(1);

      const valueBeforeStatus = parseMaybe(
        (await getRow(hostDbTable, host.records[0].id))[hostFieldVo.dbFieldName]
      );
      expect(valueBeforeStatus).toEqual(1);

      const { events: filterEvents } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(foreign.id, foreign.records[1].id, statusId, 'include');
      });
      const valueAfterStatus = parseMaybe(
        (await getRow(hostDbTable, host.records[0].id))[hostFieldVo.dbFieldName]
      );
      expect(valueAfterStatus).toEqual(2);
      const hostFilterEvent = filterEvents.find((e) => e.payload.tableId === host.id);
      expect(hostFilterEvent).toBeDefined();
      const filterRecordPayload = Array.isArray(hostFilterEvent!.payload.record)
        ? hostFilterEvent!.payload.record[0]
        : hostFilterEvent!.payload.record;
      const filterChanges = filterRecordPayload.fields as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(filterChanges[conditionalRollupField.id]).toBeDefined();
      expect(filterChanges[conditionalRollupField.id].newValue).toEqual(2);

      const { events: lookupColumnEvents } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(foreign.id, foreign.records[0].id, titleId, null);
      });
      const valueAfterLookupColumnChange = parseMaybe(
        (await getRow(hostDbTable, host.records[0].id))[hostFieldVo.dbFieldName]
      );
      expect(valueAfterLookupColumnChange).toEqual(1);
      const hostLookupEvent = lookupColumnEvents.find((e) => e.payload.tableId === host.id);
      expect(hostLookupEvent).toBeDefined();
      const lookupRecordPayload = Array.isArray(hostLookupEvent!.payload.record)
        ? hostLookupEvent!.payload.record[0]
        : hostLookupEvent!.payload.record;
      const lookupChanges = lookupRecordPayload.fields as Record<
        string,
        { oldValue: unknown; newValue: unknown }
      >;
      expect(lookupChanges[conditionalRollupField.id]).toBeDefined();
      expect(lookupChanges[conditionalRollupField.id].newValue).toEqual(1);

      expect(
        parseMaybe((await getRow(hostDbTable, host.records[0].id))[hostFieldVo.dbFieldName])
      ).toEqual(1);

      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    const setupEqualityConditionalRollup = async (
      expression: string,
      options?: {
        extraFilterItems?: (ids: {
          foreignEmailId: string;
          foreignAmountId: string;
          hostEmailId: string;
        }) => IFilterItem[];
      }
    ) => {
      const foreign = await createTable(baseId, {
        name: `RefLookup_Equality_Foreign_${expression}`,
        fields: [
          { name: 'Email', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Email: 'alice@example.com', Amount: 10 } },
          { fields: { Email: 'alice@example.com', Amount: 20 } },
          { fields: { Email: 'bob@example.com', Amount: 5 } },
        ],
      });
      const foreignEmailId = foreign.fields.find((f) => f.name === 'Email')!.id;
      const foreignAmountId = foreign.fields.find((f) => f.name === 'Amount')!.id;

      const host = await createTable(baseId, {
        name: `RefLookup_Equality_Host_${expression}`,
        fields: [{ name: 'Email', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { Email: 'alice@example.com' } },
          { fields: { Email: 'nobody@example.com' } },
        ],
      });
      const hostEmailId = host.fields.find((f) => f.name === 'Email')!.id;
      const aliceRecordId = host.records[0].id;
      const nobodyRecordId = host.records[1].id;

      const filterSet: Array<IFilter | IFilterItem> = [
        {
          fieldId: foreignEmailId,
          operator: FilterOperatorIs.value,
          value: { type: 'field', fieldId: hostEmailId },
        },
      ];

      const additionalFilterItems = options?.extraFilterItems?.({
        foreignEmailId,
        foreignAmountId,
        hostEmailId,
      });
      if (additionalFilterItems?.length) {
        filterSet.push(...additionalFilterItems);
      }

      const { result: rollupField, events } = await runAndCaptureRecordUpdates(async () => {
        return await createField(host.id, {
          name: `Equality ${expression}`,
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: foreignAmountId,
            expression,
            filter: {
              conjunction: 'and',
              filterSet,
            },
          },
        } as IFieldRo);
      });

      const hostDbTable = await getDbTableName(host.id);
      const hostFieldVo = (await getFields(host.id)).find((f) => f.id === rollupField.id)! as any;

      return {
        foreign,
        host,
        rollupField,
        creationEvents: events,
        foreignEmailId,
        foreignAmountId,
        hostEmailId,
        hostDbTable,
        hostFieldVo,
        aliceRecordId,
        nobodyRecordId,
        cleanup: async () => {
          await permanentDeleteTable(baseId, host.id);
          await permanentDeleteTable(baseId, foreign.id);
        },
      };
    };

    const normalizeAggregateValue = (value: unknown): number | null | undefined => {
      if (value === null || value === undefined) return value as null | undefined;
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value.trim().length) {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) return parsed;
      }
      return value as number | null | undefined;
    };

    const expectAggregateValue = (
      value: unknown,
      expected: number | null,
      mode: 'equal' | 'closeTo' = 'equal'
    ) => {
      if (expected === null) {
        expect(value === null || value === undefined).toBe(true);
        return;
      }
      const normalized = normalizeAggregateValue(value);
      expect(typeof normalized === 'number' && !Number.isNaN(normalized)).toBe(true);
      if (mode === 'closeTo') {
        expect(normalized as number).toBeCloseTo(expected, 6);
      } else {
        expect(normalized).toEqual(expected);
      }
    };

    type EqualityAggregateContext = Awaited<ReturnType<typeof setupEqualityConditionalRollup>>;

    const equalityAggregateCases: Array<{
      expression: string;
      initialAlice: number | null;
      initialNobody: number | null;
      updatedAlice: number | null;
      updatedNobody?: number | null;
      update: (ctx: EqualityAggregateContext) => Promise<void>;
      compareMode?: 'equal' | 'closeTo';
    }> = [
      {
        expression: 'count({values})',
        initialAlice: 2,
        initialNobody: 0,
        updatedAlice: 3,
        update: async (ctx) => {
          await createRecords(ctx.foreign.id, {
            records: [
              {
                fields: {
                  [ctx.foreignEmailId]: 'alice@example.com',
                  [ctx.foreignAmountId]: 12,
                },
              },
            ],
          });
        },
      },
      {
        expression: 'countall({values})',
        initialAlice: 2,
        initialNobody: 0,
        updatedAlice: 3,
        update: async (ctx) => {
          await createRecords(ctx.foreign.id, {
            records: [
              {
                fields: {
                  [ctx.foreignEmailId]: 'alice@example.com',
                  [ctx.foreignAmountId]: 9,
                },
              },
            ],
          });
        },
      },
      {
        expression: 'sum({values})',
        initialAlice: 30,
        initialNobody: 0,
        updatedAlice: 45,
        update: async (ctx) => {
          await createRecords(ctx.foreign.id, {
            records: [
              {
                fields: {
                  [ctx.foreignEmailId]: 'alice@example.com',
                  [ctx.foreignAmountId]: 15,
                },
              },
            ],
          });
        },
      },
      {
        expression: 'average({values})',
        initialAlice: 15,
        initialNobody: 0,
        updatedAlice: 20,
        compareMode: 'closeTo',
        update: async (ctx) => {
          await createRecords(ctx.foreign.id, {
            records: [
              {
                fields: {
                  [ctx.foreignEmailId]: 'alice@example.com',
                  [ctx.foreignAmountId]: 30,
                },
              },
            ],
          });
        },
      },
      {
        expression: 'max({values})',
        initialAlice: 20,
        initialNobody: null,
        updatedAlice: 25,
        updatedNobody: null,
        update: async (ctx) => {
          await createRecords(ctx.foreign.id, {
            records: [
              {
                fields: {
                  [ctx.foreignEmailId]: 'alice@example.com',
                  [ctx.foreignAmountId]: 25,
                },
              },
            ],
          });
        },
      },
      {
        expression: 'min({values})',
        initialAlice: 10,
        initialNobody: null,
        updatedAlice: 4,
        updatedNobody: null,
        update: async (ctx) => {
          await createRecords(ctx.foreign.id, {
            records: [
              {
                fields: {
                  [ctx.foreignEmailId]: 'alice@example.com',
                  [ctx.foreignAmountId]: 4,
                },
              },
            ],
          });
        },
      },
    ];

    describe('conditional rollup equality aggregates', () => {
      it.each(equalityAggregateCases)(
        'evaluates $expression with equality filter',
        async ({
          expression,
          compareMode = 'equal',
          initialAlice,
          initialNobody,
          updatedAlice,
          updatedNobody,
          update,
        }) => {
          const ctx = await setupEqualityConditionalRollup(expression);
          const { cleanup } = ctx;
          try {
            const createAliceChange = findRecordChangeMap(
              ctx.creationEvents,
              ctx.host.id,
              ctx.aliceRecordId
            );
            expect(createAliceChange).toBeDefined();
            expectAggregateValue(
              createAliceChange?.[ctx.rollupField.id]?.newValue,
              initialAlice,
              compareMode
            );

            const createNobodyChange = findRecordChangeMap(
              ctx.creationEvents,
              ctx.host.id,
              ctx.nobodyRecordId
            );
            expect(createNobodyChange).toBeDefined();
            expectAggregateValue(
              createNobodyChange?.[ctx.rollupField.id]?.newValue,
              initialNobody,
              compareMode
            );

            const initialAliceValue = parseMaybe(
              (await getRow(ctx.hostDbTable, ctx.aliceRecordId))[ctx.hostFieldVo.dbFieldName]
            );
            expectAggregateValue(initialAliceValue, initialAlice, compareMode);

            const initialNobodyValue = parseMaybe(
              (await getRow(ctx.hostDbTable, ctx.nobodyRecordId))[ctx.hostFieldVo.dbFieldName]
            );
            expectAggregateValue(initialNobodyValue, initialNobody, compareMode);

            const { events: updateEvents } = await runAndCaptureRecordUpdates(async () => {
              await update(ctx);
            });

            const updateAliceChange = findRecordChangeMap(
              updateEvents,
              ctx.host.id,
              ctx.aliceRecordId
            );
            expect(updateAliceChange).toBeDefined();
            expectAggregateValue(
              updateAliceChange?.[ctx.rollupField.id]?.newValue,
              updatedAlice,
              compareMode
            );

            const updatedAliceValue = parseMaybe(
              (await getRow(ctx.hostDbTable, ctx.aliceRecordId))[ctx.hostFieldVo.dbFieldName]
            );
            expectAggregateValue(updatedAliceValue, updatedAlice, compareMode);

            const updatedNobodyValue = parseMaybe(
              (await getRow(ctx.hostDbTable, ctx.nobodyRecordId))[ctx.hostFieldVo.dbFieldName]
            );
            expectAggregateValue(updatedNobodyValue, updatedNobody ?? initialNobody, compareMode);
          } finally {
            await cleanup();
          }
        }
      );

      it('evaluates sum({values}) with equality and additional predicates', async () => {
        const ctx = await setupEqualityConditionalRollup('sum({values})', {
          extraFilterItems: ({ foreignAmountId }) => [
            {
              fieldId: foreignAmountId,
              operator: FilterOperatorIsGreater.value,
              value: 10,
            },
            {
              fieldId: foreignAmountId,
              operator: FilterOperatorIsNotEmpty.value,
              value: null,
            },
          ],
        });
        const { cleanup } = ctx;
        try {
          const createAliceChange = findRecordChangeMap(
            ctx.creationEvents,
            ctx.host.id,
            ctx.aliceRecordId
          );
          expect(createAliceChange).toBeDefined();
          expectAggregateValue(createAliceChange?.[ctx.rollupField.id]?.newValue, 20, 'equal');

          const createNobodyChange = findRecordChangeMap(
            ctx.creationEvents,
            ctx.host.id,
            ctx.nobodyRecordId
          );
          expect(createNobodyChange).toBeDefined();
          expectAggregateValue(createNobodyChange?.[ctx.rollupField.id]?.newValue, 0, 'equal');

          const initialAliceValue = parseMaybe(
            (await getRow(ctx.hostDbTable, ctx.aliceRecordId))[ctx.hostFieldVo.dbFieldName]
          );
          expectAggregateValue(initialAliceValue, 20, 'equal');

          const initialNobodyValue = parseMaybe(
            (await getRow(ctx.hostDbTable, ctx.nobodyRecordId))[ctx.hostFieldVo.dbFieldName]
          );
          expectAggregateValue(initialNobodyValue, 0, 'equal');

          const { events: updateEvents } = await runAndCaptureRecordUpdates(async () => {
            await createRecords(ctx.foreign.id, {
              records: [
                {
                  fields: {
                    [ctx.foreignEmailId]: 'alice@example.com',
                    [ctx.foreignAmountId]: 15,
                  },
                },
              ],
            });
          });

          const updateAliceChange = findRecordChangeMap(
            updateEvents,
            ctx.host.id,
            ctx.aliceRecordId
          );
          expect(updateAliceChange).toBeDefined();
          expectAggregateValue(updateAliceChange?.[ctx.rollupField.id]?.newValue, 35, 'equal');

          const updatedAliceValue = parseMaybe(
            (await getRow(ctx.hostDbTable, ctx.aliceRecordId))[ctx.hostFieldVo.dbFieldName]
          );
          expectAggregateValue(updatedAliceValue, 35, 'equal');

          const updatedNobodyValue = parseMaybe(
            (await getRow(ctx.hostDbTable, ctx.nobodyRecordId))[ctx.hostFieldVo.dbFieldName]
          );
          expectAggregateValue(updatedNobodyValue, 0, 'equal');
        } finally {
          await cleanup();
        }
      });
    });

    it('aggregates with equality-filtered sum referencing host fields', async () => {
      const foreign = await createTable(baseId, {
        name: 'RefLookup_Sum_Equality_Foreign',
        fields: [
          { name: 'Email', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Email: 'alice@example.com', Amount: 10 } },
          { fields: { Email: 'alice@example.com', Amount: 20 } },
          { fields: { Email: 'bob@example.com', Amount: 5 } },
        ],
      });
      const foreignEmailId = foreign.fields.find((f) => f.name === 'Email')!.id;
      const foreignAmountId = foreign.fields.find((f) => f.name === 'Amount')!.id;

      const host = await createTable(baseId, {
        name: 'RefLookup_Sum_Equality_Host',
        fields: [{ name: 'Email', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { Email: 'alice@example.com' } },
          { fields: { Email: 'nobody@example.com' } },
        ],
      });
      const hostEmailId = host.fields.find((f) => f.name === 'Email')!.id;
      const aliceId = host.records[0].id;
      const nobodyId = host.records[1].id;

      const { result: rollupField, events: creationEvents } = await runAndCaptureRecordUpdates(
        async () => {
          return await createField(host.id, {
            name: 'Sum By Email',
            type: FieldType.ConditionalRollup,
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: foreignAmountId,
              expression: 'sum({values})',
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: foreignEmailId,
                    operator: 'is',
                    value: { type: 'field', fieldId: hostEmailId },
                  },
                ],
              },
            },
          } as IFieldRo);
        }
      );

      const createAliceChange = findRecordChangeMap(creationEvents, host.id, aliceId);
      expect(createAliceChange).toBeDefined();
      expect(createAliceChange?.[rollupField.id]?.newValue).toEqual(30);
      const createNobodyChange = findRecordChangeMap(creationEvents, host.id, nobodyId);
      expect(createNobodyChange).toBeDefined();
      expect(createNobodyChange?.[rollupField.id]?.newValue).toEqual(0);

      const hostDbTable = await getDbTableName(host.id);
      const hostFieldVo = (await getFields(host.id)).find((f) => f.id === rollupField.id)! as any;
      expect(parseMaybe((await getRow(hostDbTable, aliceId))[hostFieldVo.dbFieldName])).toEqual(30);
      expect(parseMaybe((await getRow(hostDbTable, nobodyId))[hostFieldVo.dbFieldName])).toEqual(0);

      const { events: updateEvents } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(foreign.id, foreign.records[0].id, foreignAmountId, 15);
      });
      const updateAliceChange = findRecordChangeMap(updateEvents, host.id, aliceId);
      expect(updateAliceChange).toBeDefined();
      expect(updateAliceChange?.[rollupField.id]?.newValue).toEqual(35);
      const updateNobodyChange = findRecordChangeMap(updateEvents, host.id, nobodyId);
      expect(updateNobodyChange?.[rollupField.id]).toBeUndefined();
      expect(parseMaybe((await getRow(hostDbTable, aliceId))[hostFieldVo.dbFieldName])).toEqual(35);
      expect(parseMaybe((await getRow(hostDbTable, nobodyId))[hostFieldVo.dbFieldName])).toEqual(0);

      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('marks hasError when referenced lookup or filter fields are removed', async () => {
      const foreign = await createTable(baseId, {
        name: 'RefLookup_Dependency_Foreign',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Name: 'rowA', Amount: 2, Status: 'active' } },
          { fields: { Name: 'rowB', Amount: 5, Status: 'inactive' } },
        ],
      });
      const amountId = foreign.fields.find((f) => f.name === 'Amount')!.id;
      const statusId = foreign.fields.find((f) => f.name === 'Status')!.id;

      const host = await createTable(baseId, {
        name: 'RefLookup_Dependency_Host',
        fields: [
          { name: 'Primary', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'FilterValue', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [{ fields: { Primary: 'row1', FilterValue: 'active' } }],
      });
      const filterFieldId = host.fields.find((f) => f.name === 'FilterValue')!.id;

      const amountLookup = await createField(host.id, {
        name: 'Total Amount',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
        },
      } as IFieldRo);

      const filter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: { type: 'field', fieldId: filterFieldId },
          },
        ],
      } as any;

      const statusLookup = await createField(host.id, {
        name: 'Active Status Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: statusId,
          expression: 'count({values})',
          filter,
        },
      } as IFieldRo);

      await deleteField(foreign.id, amountId);
      const hostFieldsAfterLookupDelete = await getFields(host.id);
      const amountLookupVo = hostFieldsAfterLookupDelete.find(
        (f) => f.id === amountLookup.id
      ) as any;
      expect(amountLookupVo?.hasError).toBe(true);

      await deleteField(foreign.id, statusId);
      const hostFieldsAfterFilterDelete = await getFields(host.id);
      const statusLookupVo = hostFieldsAfterFilterDelete.find(
        (f) => f.id === statusLookup.id
      ) as any;
      expect(statusLookupVo?.hasError).toBe(true);

      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('recomputes when filter compares foreign field to host field and either side changes', async () => {
      const foreign = await createTable(baseId, {
        name: 'RefLookup_FieldRef_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'r1', Status: 'A' } },
          { fields: { Title: 'r2', Status: 'C' } },
        ],
      });
      const titleId = foreign.fields.find((f) => f.name === 'Title')!.id;
      const statusId = foreign.fields.find((f) => f.name === 'Status')!.id;

      const host = await createTable(baseId, {
        name: 'RefLookup_FieldRef_Host',
        fields: [{ name: 'Target', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Target: 'A' } }],
      });
      const targetFieldId = host.fields.find((f) => f.name === 'Target')!.id;
      const hostRecordId = host.records[0].id;

      const filter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: { type: 'field', fieldId: targetFieldId },
          },
        ],
      } as any;

      const { result: conditionalRollupField, events: creationEvents } =
        await runAndCaptureRecordUpdates(async () => {
          return await createField(host.id, {
            name: 'Status Matches',
            type: FieldType.ConditionalRollup,
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: titleId,
              expression: 'count({values})',
              filter,
            },
          } as IFieldRo);
        });

      const createChange = findRecordChangeMap(creationEvents, host.id, hostRecordId);
      expect(createChange).toBeDefined();
      expect(createChange?.[conditionalRollupField.id]?.newValue).toEqual(1);

      const hostDbTable = await getDbTableName(host.id);
      const hostFieldVo = (await getFields(host.id)).find(
        (f) => f.id === conditionalRollupField.id
      )! as any;
      expect(
        parseMaybe((await getRow(hostDbTable, hostRecordId))[hostFieldVo.dbFieldName])
      ).toEqual(1);

      const { events: hostFieldChangeEvents } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(host.id, hostRecordId, targetFieldId, 'B');
      });
      const hostFieldChange = findRecordChangeMap(hostFieldChangeEvents, host.id, hostRecordId);
      expect(hostFieldChange).toBeDefined();
      const hostFieldLookupChange = assertChange(hostFieldChange?.[conditionalRollupField.id]);
      expectNoOldValue(hostFieldLookupChange);
      expect(hostFieldLookupChange.newValue).toEqual(0);

      expect(
        parseMaybe((await getRow(hostDbTable, hostRecordId))[hostFieldVo.dbFieldName])
      ).toEqual(0);

      const { events: foreignFieldChangeEvents } = await runAndCaptureRecordUpdates(async () => {
        await updateRecordByApi(foreign.id, foreign.records[1].id, statusId, 'B');
      });
      const foreignDrivenChange = findRecordChangeMap(
        foreignFieldChangeEvents,
        host.id,
        hostRecordId
      );
      expect(foreignDrivenChange).toBeDefined();
      const foreignLookupChange = assertChange(foreignDrivenChange?.[conditionalRollupField.id]);
      expectNoOldValue(foreignLookupChange);
      expect(foreignLookupChange.newValue).toEqual(1);

      expect(
        parseMaybe((await getRow(hostDbTable, hostRecordId))[hostFieldVo.dbFieldName])
      ).toEqual(1);

      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('recomputes existing records when conditional rollup filter expands its matches', async () => {
      const foreign = await createTable(baseId, {
        name: 'RefLookup_FilterExpansion_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Note', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'r1', Status: 'include', Note: 'alpha' } },
          { fields: { Title: 'r2', Status: 'exclude', Note: 'beta' } },
        ],
      });
      const titleId = foreign.fields.find((f) => f.name === 'Title')!.id;
      const statusId = foreign.fields.find((f) => f.name === 'Status')!.id;
      const noteId = foreign.fields.find((f) => f.name === 'Note')!.id;

      const host = await createTable(baseId, {
        name: 'RefLookup_FilterExpansion_Host',
        fields: [{ name: 'DesiredStatus', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { DesiredStatus: 'include' } },
          { fields: { DesiredStatus: 'exclude' } },
        ],
      });
      const desiredStatusId = host.fields.find((f) => f.name === 'DesiredStatus')!.id;
      const hostRecordAId = host.records[0].id;
      const hostRecordBId = host.records[1].id;

      const narrowFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: { type: 'field', fieldId: desiredStatusId },
          },
          {
            fieldId: noteId,
            operator: 'is',
            value: 'alpha',
          },
        ],
      } as any;

      const { result: conditionalRollupField, events: createEvents } =
        await runAndCaptureRecordUpdates(async () => {
          return await createField(host.id, {
            name: 'Matching Rows',
            type: FieldType.ConditionalRollup,
            options: {
              foreignTableId: foreign.id,
              lookupFieldId: titleId,
              expression: 'count({values})',
              filter: narrowFilter,
            },
          } as IFieldRo);
        });

      const hostDbTable = await getDbTableName(host.id);
      const hostFieldVo = (await getFields(host.id)).find(
        (f) => f.id === conditionalRollupField.id
      )! as any;

      const createChangeA = findRecordChangeMap(createEvents, host.id, hostRecordAId);
      expect(createChangeA).toBeDefined();
      expect(createChangeA?.[conditionalRollupField.id]?.newValue).toEqual(1);

      const createChangeB = findRecordChangeMap(createEvents, host.id, hostRecordBId);
      expect(createChangeB).toBeDefined();
      expect(createChangeB?.[conditionalRollupField.id]?.newValue).toEqual(0);

      expect(
        parseMaybe((await getRow(hostDbTable, hostRecordAId))[hostFieldVo.dbFieldName])
      ).toEqual(1);
      expect(
        parseMaybe((await getRow(hostDbTable, hostRecordBId))[hostFieldVo.dbFieldName])
      ).toEqual(0);

      const wideFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: { type: 'field', fieldId: desiredStatusId },
          },
        ],
      } as any;

      const { events: filterChangeEvents } = await runAndCaptureRecordUpdates(async () => {
        await convertField(host.id, conditionalRollupField.id, {
          id: conditionalRollupField.id,
          name: conditionalRollupField.name,
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            expression: 'count({values})',
            filter: wideFilter,
          },
        } as IFieldRo);
      });

      const updatedChangeA = findRecordChangeMap(filterChangeEvents, host.id, hostRecordAId);
      if (updatedChangeA?.[conditionalRollupField.id]) {
        const change = assertChange(updatedChangeA[conditionalRollupField.id]);
        expectNoOldValue(change);
        expect(change.newValue).toEqual(1);
      }

      const updatedChangeB = findRecordChangeMap(filterChangeEvents, host.id, hostRecordBId);
      expect(updatedChangeB).toBeDefined();
      const updatedLookupChangeB = assertChange(updatedChangeB?.[conditionalRollupField.id]);
      expectNoOldValue(updatedLookupChangeB);
      expect(updatedLookupChangeB.newValue).toEqual(1);

      const valueAfterFilterChangeA = parseMaybe(
        (await getRow(hostDbTable, hostRecordAId))[hostFieldVo.dbFieldName]
      );
      expect(valueAfterFilterChangeA).toEqual(1);

      const valueAfterFilterChangeB = parseMaybe(
        (await getRow(hostDbTable, hostRecordBId))[hostFieldVo.dbFieldName]
      );
      expect(valueAfterFilterChangeB).toEqual(1);

      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('handles self-table filters comparing multiple host fields without overflowing the stack', async () => {
      const table = await createTable(baseId, {
        name: 'RefLookup_Self_FieldRefs',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Category', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Alpha', Category: 'A' } },
          { fields: { Title: 'Alpha', Category: 'A' } },
          { fields: { Title: 'Alpha', Category: 'B' } },
          { fields: { Title: 'Beta', Category: 'A' } },
        ],
      });
      const titleId = table.fields.find((f) => f.name === 'Title')!.id;
      const categoryId = table.fields.find((f) => f.name === 'Category')!.id;
      const firstAlphaId = table.records[0].id;
      const secondAlphaId = table.records[1].id;
      const alphaBId = table.records[2].id;
      const betaId = table.records[3].id;

      const duplicateFieldFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: titleId,
            operator: 'is',
            value: { type: 'field', fieldId: titleId, tableId: table.id },
          },
          {
            fieldId: categoryId,
            operator: 'is',
            value: { type: 'field', fieldId: categoryId, tableId: table.id },
          },
        ],
      } as any;

      const { result: rollupField } = await runAndCaptureRecordUpdates(async () => {
        return await createField(table.id, {
          name: 'Self Scoped Count',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: table.id,
            lookupFieldId: titleId,
            expression: 'countall({values})',
            filter: duplicateFieldFilter,
          },
        } as IFieldRo);
      });

      const references = await prisma.reference.findMany({
        where: { toFieldId: rollupField.id },
        select: { fromFieldId: true },
      });
      expect(references.map((ref) => ref.fromFieldId)).toEqual(
        expect.arrayContaining([titleId, categoryId])
      );

      const tableRecords = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const countsById = new Map(
        tableRecords.records.map((record) => [record.id, record.fields?.[rollupField.id]])
      );
      expect(countsById.get(firstAlphaId)).toEqual(2);
      expect(countsById.get(secondAlphaId)).toEqual(2);
      expect(countsById.get(alphaBId)).toEqual(1);
      expect(countsById.get(betaId)).toEqual(1);

      await updateRecordByApi(table.id, firstAlphaId, categoryId, 'B');

      const updated = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const updatedCounts = new Map(
        updated.records.map((record) => [record.id, record.fields?.[rollupField.id]])
      );
      expect(updatedCounts.get(firstAlphaId)).toEqual(2);
      expect(updatedCounts.get(secondAlphaId)).toEqual(1);
      expect(updatedCounts.get(alphaBId)).toEqual(2);
      expect(updatedCounts.get(betaId)).toEqual(1);

      await permanentDeleteTable(baseId, table.id);
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
      const changes = rec.fields as FieldChangeMap;
      const formulaChange = assertChange(changes[f.id]);
      expectNoOldValue(formulaChange);
      expect(formulaChange.newValue).toBeNull();

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
      const changes = rec.fields as FieldChangeMap;

      // A: 2; B: 3; C: 6 -> null after delete
      const bChange = assertChange(changes[b.id]);
      expectNoOldValue(bChange);
      expect(bChange.newValue).toBeNull();
      const cChange = assertChange(changes[c.id]);
      expectNoOldValue(cChange);
      expect(cChange.newValue).toBeNull();

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
      ).fields as FieldChangeMap;
      const t2Change = assertChange(t2Changes[l2.id]);
      expectNoOldValue(t2Change);
      expect(t2Change.newValue).toBeNull();

      // T3
      const t3Event = (payloads as any[]).find((e) => e.payload.tableId === t3.id)!;
      const t3Changes = (
        Array.isArray(t3Event.payload.record) ? t3Event.payload.record[0] : t3Event.payload.record
      ).fields as FieldChangeMap;
      const t3Change = assertChange(t3Changes[l3.id]);
      expectNoOldValue(t3Change);
      expect(t3Change.newValue).toBeNull();

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
      ).fields as FieldChangeMap;
      const lkpChange = assertChange(changes[lkp.id]);
      expectNoOldValue(lkpChange);
      expect(lkpChange.newValue).toBeNull();

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
      ).fields as FieldChangeMap;
      const rollChange = assertChange(changes[roll.id]);
      expectNoOldValue(rollChange);
      expect(rollChange.newValue).toBeNull();

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
        expect(events.length).toBe(1);
        const baseField = (await getFields(table.id)).find((f) => f.name === 'B')!;
        const changeMap = toChangeMap(events[0]);
        const bChange = assertChange(changeMap[baseField.id]);
        expectNoOldValue(bChange);
        expect(bChange.newValue).toBeNull();
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
        const changeMap = toChangeMap(events[0]);
        const fId = (await getFields(table.id)).find((f) => f.name === 'F')!.id;
        const fChange = assertChange(changeMap[fId]);
        expectNoOldValue(fChange);
        expect(fChange.newValue).toEqual(2);

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
        expect(events.length).toBe(1);
        const lkpField = (await getFields(t2.id)).find((f) => f.name === 'LK')!;
        const changeMap = toChangeMap(events[0]);
        const lkpChange = assertChange(changeMap[lkpField.id]);
        expectNoOldValue(lkpChange);
        expect(lkpChange.newValue).toBeNull();

        // DB: LK should be null when there is no link
        const t2Db = await getDbTableName(t2.id);
        const t2Row = await getRow(t2Db, t2.records[0].id);
        const lkpFull = lkpField as any;
        expect((t2Row as any)[lkpFull.dbFieldName]).toBeNull();
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
        const changeMap = toChangeMap(events[0]);
        const rId = (await getFields(t2.id)).find((f) => f.name === 'R')!.id;
        const rChange = assertChange(changeMap[rId]);
        expectNoOldValue(rChange);
        expect(rChange.newValue).toEqual(10);

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
      const changeMap = toChangeMap(events[0]);
      const fChange = assertChange(changeMap[f.id]);
      expectNoOldValue(fChange);
      expect(fChange.newValue).toEqual(7);

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
        expect(events.length).toBe(1);
        const textCopyField = (await getFields(table.id)).find((f) => f.name === 'Text_copy')!;
        const changeMap = toChangeMap(events[0]);
        const textCopyChange = assertChange(changeMap[textCopyField.id]);
        expectNoOldValue(textCopyChange);
        expect(textCopyChange.newValue).toBeNull();
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
        const changeMap = toChangeMap(events[0]);
        const fCopyId = (await getFields(table.id)).find((x) => x.name === 'F_copy')!.id;
        const fCopyChange = assertChange(changeMap[fCopyId]);
        expectNoOldValue(fCopyChange);
        expect(fCopyChange.newValue).toEqual(4);

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
      const changes = t2Event.payload.record.fields as FieldChangeMap;
      const linkChange = assertChange(changes[link2.id]);
      expectNoOldValue(linkChange);
      expect([linkChange.newValue]?.flat()?.[0]?.title).toEqual('Bar');

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

    it('ManyMany bidirectional link: set 1-1 -> 2-1 publishes newValue on both sides', async () => {
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

      // Assert T1 event: linkOnT1 newValue [2-1]
      const t1Changes = t1Event.payload.record.fields as FieldChangeMap;
      const t1Change = assertChange(t1Changes[linkOnT1.id]);
      expectNoOldValue(t1Change);
      expect(new Set(idsOf(t1Change.newValue))).toEqual(new Set([r2_1]));

      // Assert T2 event: symmetric link newValue [1-1]
      const t2Changes = t2Event.payload.record.fields as FieldChangeMap;
      const t2Change = assertChange(t2Changes[linkOnT2.id]);
      expectNoOldValue(t2Change);
      expect(new Set(idsOf(t2Change.newValue))).toEqual(new Set([r1_1]));

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
      ): FieldChangePayload | undefined => {
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
        const change = assertChange(getChangeFromEvent(t2Event, linkOnT2.id, rB1));
        expectNoOldValue(change);
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
        const change = assertChange(getChangeFromEvent(t2Event, linkOnT2.id, rB2));
        expectNoOldValue(change);
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
        const change = assertChange(
          getChangeFromEvent(t2Event, linkOnT2.id, rB1) || getChangeFromEvent(t2Event, linkOnT2.id)
        );
        expectNoOldValue(change);
        expect(norm(change.newValue).length).toBe(0);
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
          | FieldChangePayload
          | undefined;
        const linkChange = assertChange(change);
        expectNoOldValue(linkChange);
        expect(new Set(idsOf(linkChange.newValue))).toEqual(new Set([rA1]));
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
        const changeFor = (recordId: string) =>
          recs.find((r: any) => r.id === recordId)?.fields?.[linkOnT2.id] as
            | FieldChangePayload
            | undefined;
        const removal = assertChange(changeFor(rB1));
        expectNoOldValue(removal);
        expect(norm(removal.newValue).length).toBe(0);

        const addition = assertChange(changeFor(rB2));
        expectNoOldValue(addition);
        expect(new Set(idsOf(addition.newValue))).toEqual(new Set([rA1]));
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
          | FieldChangePayload
          | undefined;
        const addChange = assertChange(change);
        expectNoOldValue(addChange);
        expect(addChange.newValue?.id).toBe(rA1);
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
          | FieldChangePayload
          | undefined;
        const addChange = assertChange(change);
        expectNoOldValue(addChange);
        expect(addChange.newValue?.id).toBe(rA1);
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
        const change = recs.find((r: any) => r.id === rB1)?.fields?.[linkOnT2.id] as
          | FieldChangePayload
          | undefined;
        const removalChange = assertChange(change);
        expectNoOldValue(removalChange);
        expect(removalChange.newValue).toBeNull();
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

    it('ManyMany: removing unrelated item still republishes unchanged counterpart with newValue only', async () => {
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
      //    - T1[1-1] re-published with same newValue (oldValue missing)
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

      const changeOn11 = recs.find((r: any) => r.id === r1_1)?.fields?.[linkOnT1.id] as
        | FieldChangePayload
        | undefined;
      const changeOn12 = recs.find((r: any) => r.id === r1_2)?.fields?.[linkOnT1.id] as
        | FieldChangePayload
        | undefined;

      const removalChange = assertChange(changeOn12); // 1-2 removed 2-1
      expectNoOldValue(removalChange);
      expect(removalChange.newValue).toBeNull();

      const unchangedRepublish = assertChange(changeOn11);
      expectNoOldValue(unchangedRepublish);
      const idsOf = (v: any) =>
        (Array.isArray(v) ? v : v ? [v] : []).map((item: any) => item?.id).filter(Boolean);
      expect(new Set(idsOf(unchangedRepublish.newValue))).toEqual(new Set([r2_1]));

      await permanentDeleteTable(baseId, t2.id);
      await permanentDeleteTable(baseId, t1.id);
    });
  });
});
