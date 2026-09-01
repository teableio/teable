import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { RecordReadonlyServiceAdapter } from '../src/share-db/readonly/record-readonly.service';
import type { IClsStore } from '../src/types/cls';
import { createRecords, createTable, initApp, permanentDeleteTable } from './utils/init-app';

// A grid scroll fetches up to 300 records at once and a wide view projects
// every visible field. The ShareDB readonly adapter forwards that request to
// its own HTTP API, so it must not be sensitive to ids/projection size: as GET
// query params this payload exceeds Node's 16KB header limit and the server
// rejects it with 431 before routing.
const FIELD_COUNT = 300;
const RECORD_COUNT = 300;

describe('Record socket snapshot-bulk (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;
  let recordIds: string[];

  beforeAll(async () => {
    const bundle = await initApp();
    app = bundle.app;
    cookie = bundle.cookie;

    table = await createTable(baseId, {
      name: 'snapshot-bulk wide',
      fields: Array.from({ length: FIELD_COUNT }, (_, i) => ({
        name: `text ${i}`,
        type: FieldType.SingleLineText,
      })),
    });

    const created = await createRecords(table.id, {
      records: Array.from({ length: RECORD_COUNT }, (_, i) => ({
        fields: { [table.fields[0].id]: `record ${i}` },
      })),
    });
    recordIds = created.records.map((record) => record.id);
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
  });

  it('loads a 300-record window with a full wide projection', async () => {
    const adapter = app.get(RecordReadonlyServiceAdapter);
    const clsService = app.get<ClsService<IClsStore>>(ClsService);
    const projection = Object.fromEntries(table.fields.map((field) => [field.id, true]));

    // Guard the regression premise: keep the payload large enough that the old
    // GET-with-query transport could not have carried it (16KB header limit).
    // Sized with axios' serialization, which keeps [] brackets unescaped.
    const asGetQueryLength =
      recordIds.reduce((sum, id) => sum + `ids[]=${id}&`.length, 0) +
      table.fields.reduce((sum, field) => sum + `projection[${field.id}]=true&`.length, 0);
    expect(asGetQueryLength).toBeGreaterThan(16 * 1024);

    const snapshots = await clsService.runWith(
      {
        user: {
          id: globalThis.testConfig.userId,
          name: globalThis.testConfig.userName,
          email: globalThis.testConfig.email,
          isAdmin: false,
        },
        origin: { ip: '127.0.0.1', byApi: false, userAgent: 'test-agent', referer: '' },
        tx: {},
        permissions: [],
        cookie,
      } as IClsStore,
      () => adapter.getSnapshotBulk(table.id, recordIds, projection)
    );

    expect(snapshots).toHaveLength(RECORD_COUNT);
    const byId = new Map(snapshots.map((snapshot) => [snapshot.data.id, snapshot]));
    recordIds.forEach((recordId, i) => {
      expect(byId.get(recordId)?.data.fields[table.fields[0].id]).toEqual(`record ${i}`);
    });
  });
});
