/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention */

import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions, IRecord, ITableFullVo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { updateRecords as apiUpdateRecords } from '@teable/openapi';
import type { Knex } from 'knex';
import type { Doc } from 'sharedb/lib/client';
import { Connection } from 'sharedb/lib/client';
import type { Socket } from 'sharedb/lib/sharedb';
import SockJS from 'sockjs-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createField,
  createTable,
  getFields,
  getRecord,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

describe('link id-only payload title regression (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let knex: Knex;
  const baseId = globalThis.testConfig.baseId;
  let launchesTable: ITableFullVo | undefined;
  let releasesTable: ITableFullVo | undefined;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    knex = app.get('CUSTOM_KNEX' as never) as Knex;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    if (launchesTable) {
      await permanentDeleteTable(baseId, launchesTable.id);
      launchesTable = undefined;
    }
    if (releasesTable) {
      await permanentDeleteTable(baseId, releasesTable.id);
      releasesTable = undefined;
    }
  });

  it('persists titled link values after updating a manyMany link with a string id array', async () => {
    const suffix = getRandomString(6);

    launchesTable = await createTable(baseId, {
      name: `launches-id-only-${suffix}`,
      fields: [{ name: 'Launch', type: FieldType.SingleLineText }],
      records: [{ fields: { Launch: 'Launch 1' } }],
    });

    releasesTable = await createTable(baseId, {
      name: `releases-id-only-${suffix}`,
      fields: [{ name: 'Tag', type: FieldType.SingleLineText }],
      records: [{ fields: { Tag: 'R1' } }, { fields: { Tag: 'R2' } }],
    });

    const linkField = await createField(launchesTable.id, {
      name: 'Related Releases',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: releasesTable.id,
      },
    });

    const releaseFields = await getFields(releasesTable.id);
    const symmetricField = releaseFields.find(
      (field) =>
        field.type === FieldType.Link &&
        (field.options as ILinkFieldOptions | undefined)?.foreignTableId === launchesTable!.id
    );
    expect(symmetricField).toBeDefined();
    if (!symmetricField) {
      throw new Error('Missing symmetric field on releases table');
    }

    const launchId = launchesTable.records[0].id;
    const releaseIds = releasesTable.records.map((record) => record.id);

    const updateResult = await updateRecord(launchesTable.id, launchId, {
      typecast: true,
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [linkField.id]: releaseIds,
        },
      },
    });

    const storedRows = await prisma
      .txClient()
      .$queryRawUnsafe<
        { value: unknown }[]
      >(knex(launchesTable.dbTableName).select({ value: linkField.dbFieldName }).where('__id', launchId).toQuery());

    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]?.value).toEqual([
      { id: releaseIds[0], title: 'R1' },
      { id: releaseIds[1], title: 'R2' },
    ]);

    expect(updateResult.fields[linkField.id]).toEqual([
      { id: releaseIds[0], title: 'R1' },
      { id: releaseIds[1], title: 'R2' },
    ]);

    const launchRecord = await getRecord(launchesTable.id, launchId);
    expect(launchRecord.fields[linkField.id]).toEqual([
      { id: releaseIds[0], title: 'R1' },
      { id: releaseIds[1], title: 'R2' },
    ]);

    const { records: releaseRecords } = await getRecords(releasesTable.id, {
      fieldKeyType: FieldKeyType.Id,
    });
    expect(releaseRecords[0].fields[symmetricField.id]).toEqual([
      { id: launchId, title: 'Launch 1' },
    ]);
    expect(releaseRecords[1].fields[symmetricField.id]).toEqual([
      { id: launchId, title: 'Launch 1' },
    ]);
  });
});

describe('asynchronous link title realtime (e2e)', () => {
  let app: INestApplication;
  let cookie: string;
  let launchesTable: ITableFullVo | undefined;
  let releasesTable: ITableFullVo | undefined;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    vi.stubEnv('FORCE_V2_ALL', 'true');
    // The shared e2e setup forces sync, which masks missing titles in user events
    // with a computed snapshot. Exercise the production hybrid/outbox path.
    vi.stubEnv('V2_COMPUTED_UPDATE_MODE', undefined);
    const appCtx = await initApp();
    app = appCtx.app;
    cookie = appCtx.cookie;
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    if (launchesTable) await permanentDeleteTable(baseId, launchesTable.id);
    if (releasesTable) await permanentDeleteTable(baseId, releasesTable.id);
  });

  it.each([Relationship.ManyOne, Relationship.ManyMany])(
    'keeps subscribed %s link titles after an id-only batch update with existing lookups',
    { timeout: 30_000 },
    async (relationship) => {
      const count = 153;
      const isMultiple = relationship === Relationship.ManyMany;
      releasesTable = await createTable(baseId, {
        name: 'Realtime link targets',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Body', type: FieldType.LongText },
          { name: 'URL', type: FieldType.SingleLineText },
        ],
        records: Array.from({ length: count }, (_, index) => ({
          fields: {
            Title: `Target ${index}`,
            Body: `Body ${index}`,
            URL: `https://example.com/items/${index}`,
          },
        })),
      });
      launchesTable = await createTable(baseId, {
        name: 'Realtime link sources',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: Array.from({ length: count }, (_, index) => ({
          fields: { Name: `Source ${index}` },
        })),
      });

      const socket = new SockJS(`http://127.0.0.1:${process.env.PORT}/socket`, null, {
        transports: ['websocket'],
        transportOptions: { websocket: { headers: { cookie } } },
      });
      const connection = new Connection(socket as Socket);
      const doc: Doc<IRecord> = connection.get(
        `rec_${launchesTable.id}`,
        launchesTable.records[0].id
      );
      try {
        const linkField = await createField(launchesTable.id, {
          name: 'Related target',
          type: FieldType.Link,
          options: {
            relationship,
            foreignTableId: releasesTable.id,
          },
        });
        const bodyLookup = await createField(launchesTable.id, {
          name: 'Target body',
          type: FieldType.LongText,
          isLookup: true,
          lookupOptions: {
            linkFieldId: linkField.id,
            foreignTableId: releasesTable.id,
            lookupFieldId: releasesTable.fields[1].id,
          },
        });
        const urlLookup = await createField(launchesTable.id, {
          name: 'Target URL',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            linkFieldId: linkField.id,
            foreignTableId: releasesTable.id,
            lookupFieldId: releasesTable.fields[2].id,
          },
        });
        await new Promise<void>((resolve, reject) => {
          doc.subscribe((error) => (error ? reject(error) : resolve()));
        });
        const linkBroadcasts: unknown[] = [];
        connection.on(
          'receive',
          ({
            data,
          }: {
            data: { d?: string; src?: string; op?: { p: unknown[]; oi?: unknown }[] };
          }) => {
            // Snapshot catch-up has a different source and must not satisfy this assertion.
            if (data.d !== doc.id || !data.src?.startsWith('@@v2-projection:')) return;
            for (const op of data.op ?? []) {
              if (op.p.length === 2 && op.p[0] === 'fields' && op.p[1] === linkField.id) {
                linkBroadcasts.push(op.oi);
              }
            }
          }
        );

        const response = await apiUpdateRecords(launchesTable.id, {
          typecast: true,
          fieldKeyType: FieldKeyType.Id,
          records: launchesTable.records.map((record, index) => ({
            id: record.id,
            fields: {
              [linkField.id]: isMultiple
                ? [{ id: releasesTable!.records[index].id }]
                : { id: releasesTable!.records[index].id },
            },
          })),
        });

        const targetLink = { id: releasesTable.records[0].id, title: 'Target 0' };
        const expectedFields = {
          [linkField.id]: isMultiple ? [targetLink] : targetLink,
          [bodyLookup.id]: isMultiple ? ['Body 0'] : 'Body 0',
          [urlLookup.id]: isMultiple
            ? ['https://example.com/items/0']
            : 'https://example.com/items/0',
        };
        await expect
          .poll(() => linkBroadcasts[0], { timeout: 15_000 })
          .toEqual(expectedFields[linkField.id]);
        await expect
          .poll(async () => (await getRecord(launchesTable!.id, doc.id)).fields, {
            timeout: 15_000,
          })
          .toMatchObject(expectedFields);
        await expect.poll(() => doc.data.fields, { timeout: 15_000 }).toMatchObject(expectedFields);
        expect(response.data.map((record) => record.fields[linkField.id])).toEqual(
          releasesTable.records.map((record, index) => {
            const value = { id: record.id, title: `Target ${index}` };
            return isMultiple ? [value] : value;
          })
        );

        const cleared = await apiUpdateRecords(launchesTable.id, {
          typecast: true,
          fieldKeyType: FieldKeyType.Id,
          records: [{ id: doc.id, fields: { [linkField.id]: null } }],
        });
        expect(cleared.data[0].fields[linkField.id] ?? null).toBeNull();
        await expect.poll(() => linkBroadcasts.at(-1)).toBeNull();
        await expect.poll(() => doc.data.fields[linkField.id]).toBeNull();
      } finally {
        doc.destroy();
        connection.close();
      }
    }
  );
});
