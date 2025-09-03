/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, IdPrefix, Relationship } from '@teable/core';
import { enableShareView as apiEnableShareView, updateRecords } from '@teable/openapi';
import type { Doc } from 'sharedb/lib/client';
import { ShareDbService } from '../src/share-db/share-db.service';
import {
  initApp,
  createTable,
  permanentDeleteTable,
  createField,
  createRecords,
  updateRecord,
  getRecords,
} from './utils/init-app';
import { subscribeDocs, waitFor } from './utils/wait';

describe('Realtime Ops on Field Create (e2e)', () => {
  let app: INestApplication;
  let shareDbService!: ShareDbService;
  let appUrl: string;

  const baseId = (globalThis as any).testConfig.baseId as string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should publish record ops when creating a formula field', async () => {
    // 1. Create a table and enable share view for socket access
    const table = await createTable(baseId, { name: 'rt-op-table' });
    const tableId = table.id;
    const viewId = table.views[0].id;
    const shareResult = await apiEnableShareView({ tableId, viewId });
    const shareId = shareResult.data.shareId;

    try {
      // 2. Create a number field and some records
      const numberField = await createField(tableId, { type: FieldType.Number });
      const recResult = await createRecords(tableId, {
        fieldKeyType: FieldKeyType.Name,
        records: [{ fields: { [numberField.name]: 2 } }, { fields: { [numberField.name]: 3 } }],
      });
      const createdRecords = (await getRecords(tableId)).records.slice(-2);
      const [r1, r2] = createdRecords;

      // 3. Connect to ShareDB over WS and subscribe to record docs
      const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareId}`;
      const connection = shareDbService.connect(undefined, { url: wsUrl, headers: {} });

      const collection = `${IdPrefix.Record}_${tableId}`;
      const doc1: Doc<any> = connection.get(collection, r1.id);
      const doc2: Doc<any> = connection.get(collection, r2.id);

      // Ensure docs are subscribed before triggering the operation
      await subscribeDocs([doc1, doc2]);

      // 4. Set up listeners to capture setRecord ops for the formula field
      const values = new Map<string, unknown>();
      let formulaFieldId = '';

      const capture = (id: string) => (ops: any[]) => {
        if (!formulaFieldId) return; // wait until known
        const hit = ops?.find(
          (op) => Array.isArray(op.p) && op.p[0] === 'fields' && op.p[1] === formulaFieldId
        );
        if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) {
          values.set(id, hit.oi);
        }
      };

      doc1.on('op', capture(r1.id));
      doc2.on('op', capture(r2.id));

      // 5. Create a formula field referencing the number field: {n} + 1
      const formulaField = await createField(tableId, {
        type: FieldType.Formula,
        options: { expression: `{${numberField.id}} + 1` },
      });
      formulaFieldId = formulaField.id;

      // 6. Wait for both docs to receive ops for the new formula field
      await waitFor(() => values.size >= 2);

      // 7. Assert values are 3 and 4
      const received = [values.get(r1.id), values.get(r2.id)];
      expect(received.sort()).toEqual([3, 4]);
    } finally {
      await permanentDeleteTable(baseId, tableId);
    }
  });

  it('should publish record ops when creating a lookup field', async () => {
    // A: source table with titles
    const tableA = await createTable(baseId, {
      name: 'A',
      records: [{ fields: {} }, { fields: {} }],
    });
    const titleFieldA = tableA.fields[0];
    const aRecords = (await getRecords(tableA.id)).records;
    // Set titles to A1, A2
    await updateRecords(tableA.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: aRecords[0].id, fields: { [titleFieldA.id]: 'A1' } },
        { id: aRecords[1].id, fields: { [titleFieldA.id]: 'A2' } },
      ],
    });

    // B: target table with two empty records
    const tableB = await createTable(baseId, {
      name: 'B',
      records: [{ fields: {} }, { fields: {} }],
    });
    // Create link in B -> A (ManyOne)
    const linkField = await createField(tableB.id, {
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: tableA.id },
    });

    // Enable share on B to subscribe
    const viewId = tableB.views[0].id;
    const shareResult = await apiEnableShareView({ tableId: tableB.id, viewId });
    const shareId = shareResult.data.shareId;

    // Link B records to A records
    const bRecords = (await getRecords(tableB.id)).records;
    await updateRecord(tableB.id, bRecords[0].id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [linkField.id]: { id: aRecords[0].id } } },
    });
    await updateRecord(tableB.id, bRecords[1].id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [linkField.id]: { id: aRecords[1].id } } },
    });

    // Subscribe docs for B
    const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareId}`;
    const connection = shareDbService.connect(undefined, { url: wsUrl, headers: {} });
    const collection = `${IdPrefix.Record}_${tableB.id}`;
    const d1: Doc<any> = connection.get(collection, bRecords[0].id);
    const d2: Doc<any> = connection.get(collection, bRecords[1].id);
    await subscribeDocs([d1, d2]);

    const values = new Map<string, unknown>();
    let lookupFieldId = '';
    const capture = (id: string) => (ops: any[]) => {
      if (!lookupFieldId) return;
      const hit = ops?.find(
        (op) => Array.isArray(op.p) && op.p[0] === 'fields' && op.p[1] === lookupFieldId
      );
      if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) values.set(id, hit.oi);
    };
    d1.on('op', capture(bRecords[0].id));
    d2.on('op', capture(bRecords[1].id));

    // Create lookup field in B that looks up A's primary field via link
    const lookupField = await createField(tableB.id, {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: tableA.id,
        linkFieldId: linkField.id,
        lookupFieldId: titleFieldA.id,
      },
    } as any);
    lookupFieldId = lookupField.id;

    // Wait for ops
    await waitFor(() => values.size >= 2);

    expect(values.get(bRecords[0].id)).toEqual('A1');
    expect(values.get(bRecords[1].id)).toEqual('A2');
  });

  it('should publish record ops when creating a rollup field', async () => {
    // A: source with Number field values 2, 3
    const tableA = await createTable(baseId, {
      name: 'A2',
      records: [{ fields: {} }, { fields: {} }],
    });
    const numberField = await createField(tableA.id, { type: FieldType.Number });
    const aRecs = (await getRecords(tableA.id)).records;
    await updateRecords(tableA.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: aRecs[0].id, fields: { [numberField.id]: 2 } },
        { id: aRecs[1].id, fields: { [numberField.id]: 3 } },
      ],
    });

    // B with link -> A (ManyMany) and 1 record linked to both A recs
    const tableB = await createTable(baseId, { name: 'B2', records: [{ fields: {} }] });
    const linkField2 = await createField(tableB.id, {
      type: FieldType.Link,
      options: { relationship: Relationship.ManyMany, foreignTableId: tableA.id },
    });
    // Link bRec to both A recs
    const bRec = (await getRecords(tableB.id)).records[0];

    // Share and subscribe B record
    const shareRes = await apiEnableShareView({ tableId: tableB.id, viewId: tableB.views[0].id });
    const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareRes.data.shareId}`;
    const connection = shareDbService.connect(undefined, { url: wsUrl, headers: {} });
    const col = `${IdPrefix.Record}_${tableB.id}`;
    const doc: Doc<any> = connection.get(col, bRec.id);
    await subscribeDocs([doc]);

    await updateRecord(tableB.id, bRec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [linkField2.id]: [{ id: aRecs[0].id }, { id: aRecs[1].id }] } },
    });

    const values: any[] = [];
    let rollupFieldId = '';
    doc.on('op', (ops: any[]) => {
      if (!rollupFieldId) return;
      const hit = ops?.find(
        (op) => Array.isArray(op.p) && op.p[0] === 'fields' && op.p[1] === rollupFieldId
      );
      if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) values.push(hit.oi);
    });

    // Create rollup field in B: sum over linked A.number
    const rollupField = await createField(tableB.id, {
      type: FieldType.Rollup,
      options: { expression: 'sum({values})' },
      lookupOptions: {
        foreignTableId: tableA.id,
        linkFieldId: linkField2.id,
        lookupFieldId: numberField.id,
      },
    } as any);
    rollupFieldId = rollupField.id;

    await waitFor(() => values.length >= 1);
    expect(values[0]).toEqual(5);
  });
});
