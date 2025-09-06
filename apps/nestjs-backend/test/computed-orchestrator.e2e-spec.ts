/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import { ComputedOrchestratorService } from '../src/features/computed/services/computed-orchestrator.service';
import {
  createField,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('Computed Orchestrator (e2e)', () => {
  let app: INestApplication;
  let orchestrator: ComputedOrchestratorService;
  let cls: ClsService;
  const baseId = (globalThis as any).testConfig.baseId as string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    orchestrator = app.get(ComputedOrchestratorService);
    cls = app.get(ClsService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns empty impact when no computed fields depend on the change', async () => {
    const table = await createTable(baseId, {
      name: 'NoComputed',
      fields: [
        { name: 'Text', type: FieldType.SingleLineText } as IFieldRo,
        { name: 'Num', type: FieldType.Number } as IFieldRo,
      ],
      records: [{ fields: { Text: 'A', Num: 1 } }],
    });

    const recId = table.records[0].id;
    const textField = table.fields.find((f) => f.name === 'Text')!;

    const res = await cls.run(() =>
      orchestrator.run(table.id, [{ recordId: recId, fieldId: textField.id }])
    );
    expect(res.publishedOps).toBe(0);
    expect(res.impact).toEqual({});

    await permanentDeleteTable(baseId, table.id);
  });

  it('handles formula and formula->formula on same table', async () => {
    const table = await createTable(baseId, {
      name: 'FormulaChain',
      fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
      records: [{ fields: { A: 1 } }],
    });
    const aId = table.fields.find((f) => f.name === 'A')!.id;
    const f1 = await createField(table.id, {
      name: 'F1',
      type: FieldType.Formula,
      options: { expression: `{${aId}}` },
    } as IFieldRo);
    const f2 = await createField(table.id, {
      name: 'F2',
      type: FieldType.Formula,
      options: { expression: `{${f1.id}}` },
    } as IFieldRo);

    const recId = table.records[0].id;
    const res = await cls.run(() =>
      orchestrator.run(table.id, [{ recordId: recId, fieldId: aId }])
    );
    expect(Object.keys(res.impact)).toEqual([table.id]);
    const impact = res.impact[table.id];
    // F1 and F2 should be impacted; record is the updated record only
    expect(new Set(impact.fieldIds)).toEqual(new Set([f1.id, f2.id]));
    expect(impact.recordIds).toEqual([recId]);
    // publish 2 ops (F1, F2)
    expect(res.publishedOps).toBe(2);

    await permanentDeleteTable(baseId, table.id);
  });

  it('handles lookup single-hop and multi-hop across tables', async () => {
    // Table1 with number
    const t1 = await createTable(baseId, {
      name: 'T1',
      fields: [{ name: 'A', type: FieldType.Number } as IFieldRo],
      records: [{ fields: { A: 10 } }],
    });
    const t1A = t1.fields.find((f) => f.name === 'A')!.id;
    const t1r = t1.records[0].id;

    // Table2 link -> T1 and lookup A
    const t2 = await createTable(baseId, { name: 'T2', fields: [], records: [{ fields: {} }] });
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

    // Table3 link -> T2 and lookup LK1 (multi-hop)
    const t3 = await createTable(baseId, { name: 'T3', fields: [], records: [{ fields: {} }] });
    const link3 = await createField(t3.id, {
      name: 'L3',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: t2.id },
    } as IFieldRo);
    const lkp3 = await createField(t3.id, {
      name: 'LK2',
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: t2.id,
        linkFieldId: link3.id,
        lookupFieldId: lkp2.id,
      } as any,
    } as any);

    // Establish link values
    await updateRecordByApi(t2.id, t2.records[0].id, link2.id, [{ id: t1r }]);
    await updateRecordByApi(t3.id, t3.records[0].id, link3.id, [{ id: t2.records[0].id }]);

    // Update A on T1; orchestrator should impact T2(LK1) and then T3(LK2)
    const res = await cls.run(() => orchestrator.run(t1.id, [{ recordId: t1r, fieldId: t1A }]));
    const tables = new Set(Object.keys(res.impact));
    expect(tables.has(t2.id)).toBe(true);
    expect(tables.has(t3.id)).toBe(true);

    // Check T2 impact (lookup and possibly link title if depends on T1.A)
    const t2Impact = res.impact[t2.id];
    // T2's impacted fields should at least include the lookup field
    expect(new Set(t2Impact.fieldIds).has(lkp2.id)).toBe(true);
    expect(t2Impact.recordIds).toEqual([t2.records[0].id]);

    // Check T3 impact
    const t3Impact = res.impact[t3.id];
    expect(new Set(t3Impact.fieldIds)).toEqual(new Set([lkp3.id]));
    expect(t3Impact.recordIds).toEqual([t3.records[0].id]);

    // Ops should equal sum of impacted fields per table (each table has 1 impacted record)
    const totalFields = Object.values(res.impact).reduce((acc, v) => acc + v.fieldIds.length, 0);
    expect(res.publishedOps).toBe(totalFields);

    // Validate snapshot returns updated projections
    const t3Records = await getRecords(t3.id, { fieldKeyType: FieldKeyType.Id });
    expect(t3Records.records[0].fields[lkp3.id]).toEqual([10]);

    await permanentDeleteTable(baseId, t3.id);
    await permanentDeleteTable(baseId, t2.id);
    await permanentDeleteTable(baseId, t1.id);
  });
});
