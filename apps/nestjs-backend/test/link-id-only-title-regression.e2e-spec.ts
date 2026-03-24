/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention */

import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions, ITableFullVo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, getRandomString } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
