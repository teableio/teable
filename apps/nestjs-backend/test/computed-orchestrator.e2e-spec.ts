/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEventWithResultWithCount } from './utils/event-promise';
import {
  createField,
  createTable,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Computed Orchestrator (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;
  const baseId = (globalThis as any).testConfig.baseId as string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
  });

  afterAll(async () => {
    await app.close();
  });

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

    await permanentDeleteTable(baseId, table.id);
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

    await permanentDeleteTable(baseId, t2.id);
    await permanentDeleteTable(baseId, t1.id);
  });
});
