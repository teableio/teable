import type { INestApplication } from '@nestjs/common';
import type { IRecord, ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import type { EditOp } from 'sharedb';
import type { Connection, Doc } from 'sharedb/lib/client';
import { ShareDbAdapter } from '../src/share-db/share-db.adapter';
import { ShareDbService } from '../src/share-db/share-db.service';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecord,
  updateRecordByApi,
} from './utils/init-app';

const subscribe = (doc: Doc<IRecord>) =>
  new Promise<void>((resolve, reject) => {
    doc.subscribe((error) => (error ? reject(error) : resolve()));
  });

// Sanitized T7625 structure: three sources, a two-way manyOne link, a scalar
// text lookup, and a reverse oneMany sum. Keep the old client doc across a
// missed update: a fresh connection would hide the snapshot-recovery defect.
describe('Record socket gap recovery (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let shareDbService: ShareDbService;
  let previousForceV2All: string | undefined;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const context = await initApp();
    app = context.app;
    cookie = context.cookie;
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    await app.close();
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
  });

  it('clears an unlinked scalar lookup on the retained ShareDB doc after a version gap T7625', async () => {
    let targets: ITableFullVo | undefined;
    let sources: ITableFullVo | undefined;
    let connection: Connection | undefined;
    try {
      targets = await createTable(baseId, {
        name: 'Gap targets',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'Alpha' } }, { fields: { Name: 'Beta' } }],
      });
      sources = await createTable(baseId, {
        name: 'Gap sources',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'Source 1', Amount: 10 } },
          { fields: { Name: 'Source 2', Amount: 20 } },
          { fields: { Name: 'Source 3', Amount: 30 } },
        ],
      });
      const nameId = sources.fields[0].id;
      const amountId = sources.fields[1].id;
      const link = await createField(sources.id, {
        name: 'Target',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: targets.id,
          isOneWay: false,
        },
      });
      const lookup = await createField(sources.id, {
        name: 'Target name',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: targets.id,
          linkFieldId: link.id,
          lookupFieldId: targets.fields[0].id,
        },
      });
      const reverseId = (link.options as ILinkFieldOptions).symmetricFieldId!;
      const total = await createField(targets.id, {
        name: 'Total',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: sources.id,
          linkFieldId: reverseId,
          lookupFieldId: amountId,
        },
      });
      for (const [index, record] of sources.records.entries()) {
        await updateRecordByApi(sources.id, record.id, link.id, {
          id: targets.records[index === 2 ? 1 : 0].id,
        });
      }

      connection = shareDbService.connect(undefined, {
        url: `ws://localhost:${process.env.PORT}/socket`,
        headers: { cookie },
      });
      const doc: Doc<IRecord> = connection.get(`rec_${sources.id}`, sources.records[0].id);
      await subscribe(doc);
      expect(doc.data.fields[lookup.id]).toBe('Alpha');
      const initialVersion = doc.version;
      if (initialVersion == null) throw new Error('Subscribed record has no version');
      await new Promise<void>((resolve, reject) => {
        doc.unsubscribe((error) => (error ? reject(error) : resolve()));
      });

      await updateRecordByApi(sources.id, doc.id, link.id, null);
      const stored = await getRecord(sources.id, doc.id);
      expect(stored.fields[link.id] ?? null).toBeNull();
      expect(stored.fields[lookup.id] ?? null).toBeNull();
      expect(doc.data.fields[lookup.id]).toBe('Alpha');

      // Resubscribe uses getOps on this existing document, not a new snapshot.
      await subscribe(doc);
      expect(doc.version).toBeGreaterThan(initialVersion);
      expect(doc.data.fields).toEqual({
        [nameId]: 'Source 1',
        [amountId]: 10,
        [link.id]: null,
        [lookup.id]: null,
      });

      for (const [index, record] of sources.records.slice(1).entries()) {
        const unchanged = await getRecord(sources.id, record.id);
        expect(unchanged.fields[lookup.id]).toBe(index === 0 ? 'Alpha' : 'Beta');
        expect(unchanged.fields[amountId]).toBe([20, 30][index]);
      }
      for (const [index, target] of targets.records.entries()) {
        const current = await getRecord(targets.id, target.id);
        expect(current.fields[total.id]).toBe(index === 0 ? 20 : 30);
        expect(current.fields[reverseId]).toEqual([
          { id: sources.records[index + 1].id, title: `Source ${index + 2}` },
        ]);
      }
    } finally {
      connection?.close();
      if (sources) await permanentDeleteTable(baseId, sources.id);
      if (targets) await permanentDeleteTable(baseId, targets.id);
    }
  });
  it('clears every cached cell through bulk recovery when the REST record is empty', async () => {
    const table = await createTable(baseId, {
      name: 'Empty snapshot',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Checked', type: FieldType.Checkbox },
      ],
      records: [{ fields: { Name: 'Before', Checked: true } }],
    });
    const connection = shareDbService.connect(undefined, {
      url: `ws://localhost:${process.env.PORT}/socket`,
      headers: { cookie },
    });
    try {
      const collection = `rec_${table.id}`;
      const doc: Doc<IRecord> = connection.get(collection, table.records[0].id);
      await new Promise<void>((resolve, reject) => {
        doc.fetch((error) => (error ? reject(error) : resolve()));
      });
      expect(doc.data.fields[table.fields[1].id]).toBe(true);
      const initialVersion = doc.version;
      if (initialVersion == null) throw new Error('Fetched record has no version');
      await updateRecord(table.id, doc.id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [table.fields[0].id]: null, [table.fields[1].id]: null } },
      });
      const stored = await getRecord(table.id, doc.id);
      expect(stored.fields).toEqual({});
      const opsById = await new Promise<Record<string, EditOp[]>>((resolve, reject) => {
        app
          .get(ShareDbAdapter)
          .getOpsBulk(
            collection,
            { [doc.id]: initialVersion },
            undefined,
            { cookie },
            (error, ops) => (error ? reject(error) : resolve(ops as Record<string, EditOp[]>))
          );
      });
      let recovered = doc.data;
      for (const op of opsById[doc.id]) {
        if (op.op) recovered = doc.type!.apply(recovered, op.op);
      }
      expect(recovered.fields).toEqual({
        [table.fields[0].id]: null,
        [table.fields[1].id]: null,
      });
    } finally {
      connection.close();
      await permanentDeleteTable(baseId, table.id);
    }
  });
});
