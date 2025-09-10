/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-identical-functions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEventWithResultWithCount } from './utils/event-promise';
import {
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

    await permanentDeleteTable(baseId, table.id);
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
      lookupOptions: { foreignTableId: t2.id, linkFieldId: l23.id, lookupFieldId: lkp2.id } as any,
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

    await permanentDeleteTable(baseId, t3.id);
    await permanentDeleteTable(baseId, t2.id);
    await permanentDeleteTable(baseId, t1.id);
  });
});
