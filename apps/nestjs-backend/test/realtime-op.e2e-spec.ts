/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, IdPrefix, Relationship } from '@teable/core';
import { enableShareView as apiEnableShareView, axios, updateRecords } from '@teable/openapi';
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
  convertField,
  deleteField,
} from './utils/init-app';
import { subscribeDocs, waitFor } from './utils/wait';

describe('Realtime Ops (e2e)', () => {
  let app: INestApplication;
  let shareDbService!: ShareDbService;
  let appUrl: string;

  const baseId = (globalThis as any).testConfig.baseId as string;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    appUrl = appCtx.appUrl;
    shareDbService = app.get(ShareDbService);
    // Ensure field convert emits OPERATION_FIELD_CONVERT for dependency push
    const windowId = 'win-realtime-e2e';
    axios.interceptors.request.use((config) => {
      config.headers['X-Window-Id'] = windowId;
      return config;
    });
  });

  // Keep app running for next suite to preserve session cookie

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

  it('pushes ops when formula dependency changes (expression update)', async () => {
    const table = await createTable(baseId, { name: 'dep-formula', records: [{ fields: {} }] });
    const tableId = table.id;
    const num = await createField(tableId, { type: FieldType.Number });
    const formula = await createField(tableId, {
      type: FieldType.Formula,
      options: { expression: `{${num.id}} + 1` },
    });
    const rec = (await getRecords(tableId)).records[0];
    await updateRecord(tableId, rec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [num.id]: 3 } },
    });

    const shareRes = await apiEnableShareView({ tableId, viewId: table.views[0].id });
    const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareRes.data.shareId}`;
    const conn = shareDbService.connect(undefined, { url: wsUrl, headers: {} });
    const col = `${IdPrefix.Record}_${tableId}`;
    const doc: Doc<any> = conn.get(col, rec.id);
    await subscribeDocs([doc]);

    const p1 = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for formula op')), 8000);
      const handler = (ops: any[]) => {
        const hit = ops?.find((op) => Array.isArray(op.p) && op.p[1] === formula.id);
        if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) {
          try {
            expect(hit.oi).toBe(5);
            clearTimeout(timer);
            doc.removeListener('op', handler as any);
            resolve();
          } catch (e) {
            clearTimeout(timer);
            doc.removeListener('op', handler as any);
            reject(e);
          }
        }
      };
      doc.on('op', handler as any);
    });

    // convert formula: +1 -> +2
    await convertField(tableId, formula.id, {
      type: FieldType.Formula,
      options: { expression: `{${num.id}} + 2` },
    });
    await p1;
  });

  it('pushes ops when lookup definition changes (lookupFieldId update)', async () => {
    const tableA = await createTable(baseId, { name: 'A-upd', records: [{ fields: {} }] });
    const titleA = tableA.fields[0];
    const numA = await createField(tableA.id, { type: FieldType.Number });
    const aRec = (await getRecords(tableA.id)).records[0];
    await updateRecord(tableA.id, aRec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [titleA.id]: 'A-Title', [numA.id]: 9 } },
    });

    const tableB = await createTable(baseId, { name: 'B-upd', records: [{ fields: {} }] });
    const link = await createField(tableB.id, {
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: tableA.id },
    });
    const lookup = await createField(tableB.id, {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: tableA.id,
        linkFieldId: link.id,
        lookupFieldId: titleA.id,
      } as any,
    });
    const bRec = (await getRecords(tableB.id)).records[0];
    await updateRecord(tableB.id, bRec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [link.id]: { id: aRec.id } } },
    });

    const shareRes = await apiEnableShareView({ tableId: tableB.id, viewId: tableB.views[0].id });
    const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareRes.data.shareId}`;
    const conn = shareDbService.connect(undefined, { url: wsUrl, headers: {} });
    const col = `${IdPrefix.Record}_${tableB.id}`;
    const doc: Doc<any> = conn.get(col, bRec.id);
    await subscribeDocs([doc]);

    const p2 = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for lookup op')), 8000);
      const handler = (ops: any[]) => {
        const hit = ops?.find((op) => Array.isArray(op.p) && op.p[1] === lookup.id);
        if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) {
          try {
            expect(hit.oi).toBe(9);
            clearTimeout(timer);
            doc.removeListener('op', handler as any);
            resolve();
          } catch (e) {
            clearTimeout(timer);
            doc.removeListener('op', handler as any);
            reject(e);
          }
        }
      };
      doc.on('op', handler as any);
    });

    await convertField(tableB.id, lookup.id, {
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: tableA.id,
        linkFieldId: link.id,
        lookupFieldId: numA.id,
      } as any,
    });
    await p2;
  });

  it('pushes ops when link is converted to normal field (dependents become null)', async () => {
    const tableA = await createTable(baseId, { name: 'A2-upd', records: [{ fields: {} }] });
    const titleA = tableA.fields[0];
    const aRec = (await getRecords(tableA.id)).records[0];
    await updateRecord(tableA.id, aRec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [titleA.id]: 'T' } },
    });

    const tableB = await createTable(baseId, { name: 'B2-upd', records: [{ fields: {} }] });
    const link = await createField(tableB.id, {
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: tableA.id },
    });
    const lookup = await createField(tableB.id, {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: tableA.id,
        linkFieldId: link.id,
        lookupFieldId: titleA.id,
      } as any,
    });
    const bRec = (await getRecords(tableB.id)).records[0];
    await updateRecord(tableB.id, bRec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [link.id]: { id: aRec.id } } },
    });

    const shareRes = await apiEnableShareView({ tableId: tableB.id, viewId: tableB.views[0].id });
    const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareRes.data.shareId}`;
    const conn = shareDbService.connect(undefined, { url: wsUrl, headers: {} });
    const col = `${IdPrefix.Record}_${tableB.id}`;
    const doc: Doc<any> = conn.get(col, bRec.id);
    await subscribeDocs([doc]);

    const p3 = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for dependent null')), 8000);
      const handler = (ops: any[]) => {
        const hit = ops?.find((op) => Array.isArray(op.p) && op.p[1] === lookup.id);
        if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) {
          try {
            expect(hit.oi).toBeNull();
            clearTimeout(timer);
            doc.off('op', handler as any);
            resolve();
          } catch (e) {
            clearTimeout(timer);
            doc.off('op', handler as any);
            reject(e);
          }
        }
      };
      doc.on('op', handler as any);
    });
    await convertField(tableB.id, link.id, { type: FieldType.SingleLineText });
    await p3;
  });

  it('pushes ops when formula dependency field is deleted (formula becomes null)', async () => {
    const table = await createTable(baseId, { name: 'del-dep-formula', records: [{ fields: {} }] });
    const tableId = table.id;
    const num = await createField(tableId, { type: FieldType.Number });
    const formula = await createField(tableId, {
      type: FieldType.Formula,
      options: { expression: `{${num.id}} + 10` },
    });
    const rec = (await getRecords(tableId)).records[0];
    await updateRecord(tableId, rec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [num.id]: 1 } },
    });

    const shareRes = await apiEnableShareView({ tableId, viewId: table.views[0].id });
    const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareRes.data.shareId}`;
    const conn = shareDbService.connect(undefined, { url: wsUrl, headers: {} });
    const col = `${IdPrefix.Record}_${tableId}`;
    const doc: Doc<any> = conn.get(col, rec.id);
    await subscribeDocs([doc]);

    const p4 = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for formula null')), 8000);
      const handler = (ops: any[]) => {
        const hit = ops?.find((op) => Array.isArray(op.p) && op.p[1] === formula.id);
        if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) {
          try {
            expect(hit.oi).toBeNull();
            clearTimeout(timer);
            doc.off('op', handler as any);
            resolve();
          } catch (e) {
            clearTimeout(timer);
            doc.off('op', handler as any);
            reject(e);
          }
        }
      };
      doc.on('op', handler as any);
    });
    await deleteField(tableId, num.id);
    await p4;
  });

  it('pushes ops when looked-up field is deleted (lookup becomes null)', async () => {
    // A with an extra text field used for lookup
    const tableA = await createTable(baseId, {
      name: 'A-del-lookup',
      records: [{ fields: {} }, { fields: {} }],
    });
    const titleA = tableA.fields[0];
    const textA = await createField(tableA.id, { type: FieldType.SingleLineText });
    const aRecords = (await getRecords(tableA.id)).records;
    // set primary title to keep linkage readable, and the text field values
    await updateRecords(tableA.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [
        { id: aRecords[0].id, fields: { [titleA.id]: 'A1', [textA.id]: 'T1' } },
        { id: aRecords[1].id, fields: { [titleA.id]: 'A2', [textA.id]: 'T2' } },
      ],
    });

    // B links to A and has a lookup to A.textA
    const tableB = await createTable(baseId, {
      name: 'B-del-lookup',
      records: [{ fields: {} }, { fields: {} }],
    });
    const link = await createField(tableB.id, {
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: tableA.id },
    });
    const lookup = await createField(tableB.id, {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: tableA.id,
        linkFieldId: link.id,
        lookupFieldId: textA.id,
      },
    } as any);

    // Link B records to A records
    const bRecords = (await getRecords(tableB.id)).records;
    await updateRecord(tableB.id, bRecords[0].id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [link.id]: { id: aRecords[0].id } } },
    });
    await updateRecord(tableB.id, bRecords[1].id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [link.id]: { id: aRecords[1].id } } },
    });

    // subscribe docs for B
    const shareRes = await apiEnableShareView({ tableId: tableB.id, viewId: tableB.views[0].id });
    const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareRes.data.shareId}`;
    const conn = shareDbService.connect(undefined, { url: wsUrl, headers: {} });
    const col = `${IdPrefix.Record}_${tableB.id}`;
    const d1: Doc<any> = conn.get(col, bRecords[0].id);
    const d2: Doc<any> = conn.get(col, bRecords[1].id);
    await subscribeDocs([d1, d2]);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timeout waiting for both lookup null ops')),
        8000
      );
      const state = { a: false, b: false };
      const h1 = (ops: any[]) => {
        const hit = ops?.find((op) => Array.isArray(op.p) && op.p[1] === lookup.id);
        if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) {
          try {
            expect(hit.oi).toBeNull();
            state.a = true;
            if (state.a && state.b) {
              clearTimeout(timer);
              d1.removeListener('op', h1 as any);
              d2.removeListener('op', h2 as any);
              resolve();
            }
          } catch (e) {
            clearTimeout(timer);
            d1.removeListener('op', h1 as any);
            d2.removeListener('op', h2 as any);
            reject(e);
          }
        }
      };
      const h2 = (ops: any[]) => {
        const hit = ops?.find((op) => Array.isArray(op.p) && op.p[1] === lookup.id);
        if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) {
          try {
            expect(hit.oi).toBeNull();
            state.b = true;
            if (state.a && state.b) {
              clearTimeout(timer);
              d1.off('op', h1 as any);
              d2.off('op', h2 as any);
              resolve();
            }
          } catch (e) {
            clearTimeout(timer);
            d1.removeListener('op', h1 as any);
            d2.removeListener('op', h2 as any);
            reject(e);
          }
        }
      };
      d1.on('op', h1 as any);
      d2.on('op', h2 as any);
      deleteField(tableA.id, textA.id).catch((e) => {
        clearTimeout(timer);
        d1.removeListener('op', h1 as any);
        d2.removeListener('op', h2 as any);
        reject(e);
      });
    });
  });

  it('pushes ops when link field is deleted (lookup becomes null)', async () => {
    const tableA = await createTable(baseId, { name: 'A-del-link', records: [{ fields: {} }] });
    const titleA = tableA.fields[0];
    const aRec = (await getRecords(tableA.id)).records[0];
    await updateRecord(tableA.id, aRec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [titleA.id]: 'A-OK' } },
    });

    const tableB = await createTable(baseId, { name: 'B-del-link', records: [{ fields: {} }] });
    const link = await createField(tableB.id, {
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: tableA.id },
    });
    const lookup = await createField(tableB.id, {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: tableA.id,
        linkFieldId: link.id,
        lookupFieldId: titleA.id,
      },
    } as any);
    const bRec = (await getRecords(tableB.id)).records[0];
    await updateRecord(tableB.id, bRec.id, {
      fieldKeyType: FieldKeyType.Id,
      record: { fields: { [link.id]: { id: aRec.id } } },
    });

    const shareRes = await apiEnableShareView({ tableId: tableB.id, viewId: tableB.views[0].id });
    const wsUrl = appUrl.replace('http', 'ws') + `/socket?shareId=${shareRes.data.shareId}`;
    const conn = shareDbService.connect(undefined, { url: wsUrl, headers: {} });
    const col = `${IdPrefix.Record}_${tableB.id}`;
    const doc: Doc<any> = conn.get(col, bRec.id);
    await subscribeDocs([doc]);

    const p5 = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for link null')), 8000);
      const handler = (ops: any[]) => {
        const hit = ops?.find((op) => Array.isArray(op.p) && op.p[1] === lookup.id);
        if (hit && Object.prototype.hasOwnProperty.call(hit, 'oi')) {
          try {
            expect(hit.oi).toBeNull();
            clearTimeout(timer);
            doc.removeListener('op', handler as any);
            resolve();
          } catch (e) {
            clearTimeout(timer);
            doc.removeListener('op', handler as any);
            reject(e);
          }
        }
      };
      doc.on('op', handler as any);
    });
    await deleteField(tableB.id, link.id);
    await p5;
  });
});
