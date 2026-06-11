/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { ITableFullVo, IRecord } from '@teable/openapi';
import type { Doc, Connection } from 'sharedb/lib/client';
import { ShareDbService } from '../src/share-db/share-db.service';
import {
  convertField,
  createField,
  createTable,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

const createConnection = (
  shareDbService: ShareDbService,
  cookie: string,
  port: string
): Connection => {
  return shareDbService.connect(undefined, {
    url: `ws://localhost:${port}/socket`,
    headers: { cookie },
  });
};

const fetchRecordSnapshot = async (
  connection: Connection,
  tableId: string,
  recordId: string
): Promise<IRecord> => {
  const doc = connection.get(`rec_${tableId}`, recordId) as Doc<IRecord>;
  return await new Promise<IRecord>((resolve, reject) => {
    const timeout = setTimeout(() => {
      doc.destroy();
      reject(new Error('ShareDB record subscribe timed out'));
    }, 5000);

    doc.subscribe((error) => {
      clearTimeout(timeout);
      if (error) {
        doc.destroy();
        reject(error);
        return;
      }
      if (!doc.data) {
        doc.destroy();
        reject(new Error('ShareDB record doc has no data'));
        return;
      }
      const snapshot = doc.data;
      doc.destroy();
      resolve(snapshot);
    });
  });
};

describe('Link field multi-config toggle ShareDB regression (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let port: string;
  let shareDbService: ShareDbService;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
    port = process.env.PORT!;
    shareDbService = app.get(ShareDbService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps fresh ShareDB record snapshots populated after converting manyOne twoWay to manyMany oneWay', async () => {
    let sourceTable: ITableFullVo | undefined;
    let foreignTable: ITableFullVo | undefined;
    let connection: Connection | undefined;

    try {
      sourceTable = await createTable(baseId, {
        name: 'ShareDB Survey Responses',
        fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true } as IFieldRo],
        records: [{ fields: { Name: 'Response A' } }, { fields: { Name: 'Response B' } }],
      });

      foreignTable = await createTable(baseId, {
        name: 'ShareDB Campuses',
        fields: [
          { name: 'Branch', type: FieldType.SingleLineText, isPrimary: true } as IFieldRo,
          { name: 'District', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Center', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Room', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Branch: 'Branch A',
              District: 'District A',
              Center: 'Center A',
              Room: 'Room A',
            },
          },
        ],
      });

      const branchField = foreignTable.fields.find((field) => field.name === 'Branch');
      const districtField = foreignTable.fields.find((field) => field.name === 'District');
      const centerField = foreignTable.fields.find((field) => field.name === 'Center');
      const roomField = foreignTable.fields.find((field) => field.name === 'Room');
      expect(branchField && districtField && centerField && roomField).toBeDefined();

      const formulaField = await createField(foreignTable.id, {
        name: 'Campus Info',
        type: FieldType.Formula,
        options: {
          expression: `{${branchField!.id}}&"/"&{${districtField!.id}}&"/"&{${centerField!.id}}&"/"&{${roomField!.id}}`,
        },
      } as IFieldRo);

      const linkField = await createField(sourceTable.id, {
        name: 'Campus Info',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
          lookupFieldId: formulaField.id,
          isOneWay: false,
        },
      } as IFieldRo);

      await updateRecordByApi(sourceTable.id, sourceTable.records[0].id, linkField.id, {
        id: foreignTable.records[0].id,
      });
      await updateRecordByApi(sourceTable.id, sourceTable.records[1].id, linkField.id, {
        id: foreignTable.records[0].id,
      });

      connection = createConnection(shareDbService, cookie, port);
      const initialSnapshot = await fetchRecordSnapshot(
        connection,
        sourceTable.id,
        sourceTable.records[0].id
      );
      expect(initialSnapshot.fields[linkField.id]).toEqual(
        expect.objectContaining({
          id: foreignTable.records[0].id,
          title: 'Branch A/District A/Center A/Room A',
        })
      );

      await convertField(sourceTable.id, linkField.id, {
        name: linkField.name,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
          lookupFieldId: formulaField.id,
          isOneWay: true,
        },
      });

      const afterConvertSnapshot = await fetchRecordSnapshot(
        connection,
        sourceTable.id,
        sourceTable.records[0].id
      );
      expect(afterConvertSnapshot.fields[linkField.id]).toEqual([
        expect.objectContaining({
          id: foreignTable.records[0].id,
          title: 'Branch A/District A/Center A/Room A',
        }),
      ]);
    } finally {
      connection?.close();
      if (sourceTable) {
        await permanentDeleteTable(baseId, sourceTable.id);
      }
      if (foreignTable) {
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    }
  });
});
