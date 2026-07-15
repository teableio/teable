/* eslint-disable @typescript-eslint/naming-convention */
import { spawnSync } from 'child_process';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { getBaseDataDbMoveJob, getRecords, moveBase, moveBaseCheck } from '@teable/openapi';
import type { IBaseDataDbMoveJobStatusVo, ITableFullVo } from '@teable/openapi';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import {
  createBase,
  createRecords,
  createSpace,
  createTable,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
} from './utils/init-app';

const databaseIdentity = (url?: string) => {
  if (!url) {
    return undefined;
  }
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
};

const metaDatabaseUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;
const defaultDataDatabaseUrl =
  process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? metaDatabaseUrl;
const byodbDataDatabaseUrl = process.env.BYODB_E2E_DATA_DATABASE_URL;
const isIndependentByodbDataDb =
  databaseIdentity(metaDatabaseUrl) != null &&
  databaseIdentity(byodbDataDatabaseUrl) != null &&
  databaseIdentity(metaDatabaseUrl) !== databaseIdentity(byodbDataDatabaseUrl);
const describeByodbMove = isIndependentByodbDataDb ? describe : describe.skip;
const hasPostgresMigrationTools = ['pg_dump', 'pg_restore', 'psql'].every(
  (command) => spawnSync('which', [command], { stdio: 'ignore' }).status === 0
);
const itWithMigrationTools = hasPostgresMigrationTools ? it : it.skip;

const waitForMoveJob = async (
  baseId: string,
  jobId: string,
  timeoutMs = 180_000
): Promise<IBaseDataDbMoveJobStatusVo> => {
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = (await getBaseDataDbMoveJob(baseId, jobId)).data;
    if (status.state === 'succeeded' || status.state === 'failed' || status.state === 'cancelled') {
      return status;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for move job ${jobId}: ${JSON.stringify(status)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

describe('Base data DB move (T6175)', () => {
  let app: INestApplication;
  const spacesToCleanup: string[] = [];
  const basesToCleanup: string[] = [];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    for (const baseId of basesToCleanup.splice(0)) {
      await permanentDeleteBase(baseId).catch(() => undefined);
    }
    for (const spaceId of spacesToCleanup.splice(0)) {
      await permanentDeleteSpace(spaceId).catch(() => undefined);
    }
    await app.close();
  });

  const createDefaultSpace = async (name: string) => {
    const space = await createSpace({ name });
    spacesToCleanup.push(space.id);
    return space;
  };

  it('same data-DB move remains synchronous without jobId', async () => {
    const spaceA = await createDefaultSpace('T6175 same-db A');
    const spaceB = await createDefaultSpace('T6175 same-db B');
    const base = await createBase({
      spaceId: spaceA.id,
      name: 'T6175 same-db base',
    });
    basesToCleanup.push(base.id);

    const check = (await moveBaseCheck(base.id, spaceB.id)).data;
    expect(check.dataDb?.requiresPhysicalMove).toBe(false);

    const moveResult = (await moveBase(base.id, spaceB.id)).data;
    expect(moveResult.jobId).toBeUndefined();
    expect(moveResult.async).toBeFalsy();
  });

  describeByodbMove('cross data-DB (BYODB)', () => {
    let defaultDataDb: KnexType;
    let byodbDataDb: KnexType;

    beforeAll(async () => {
      defaultDataDb = Knex({
        client: 'pg',
        connection: defaultDataDatabaseUrl,
      });
      byodbDataDb = Knex({
        client: 'pg',
        connection: byodbDataDatabaseUrl,
      });
    });

    afterAll(async () => {
      await defaultDataDb?.destroy().catch(() => undefined);
      await byodbDataDb?.destroy().catch(() => undefined);
    });

    const createByodbSpace = async (name: string) => {
      const space = await createSpace({
        name,
        dataDb: {
          mode: 'byodb',
          url: byodbDataDatabaseUrl!,
          targetMode: 'initialize-empty',
        },
      });
      spacesToCleanup.push(space.id);
      return space;
    };

    const tableExists = async (db: KnexType, schemaName: string) => {
      const rows = await db
        .select(db.raw('1'))
        .from(db.raw('pg_namespace'))
        .where('nspname', schemaName)
        .limit(1);
      return rows.length > 0;
    };

    itWithMigrationTools(
      'T6175: moveBase check requires physical move across default and BYODB spaces',
      async () => {
        const defaultSpace = await createDefaultSpace('T6175 default source');
        const byodbSpace = await createByodbSpace('T6175 byodb target');
        const base = await createBase({
          spaceId: defaultSpace.id,
          name: 'T6175 move check base',
        });
        basesToCleanup.push(base.id);

        const check = (await moveBaseCheck(base.id, byodbSpace.id)).data;
        expect(check.dataDb?.requiresPhysicalMove).toBe(true);
        expect(check.dataDb?.sameDataDb).toBe(false);
      }
    );

    itWithMigrationTools(
      'T6175: default → BYODB physical move preserves records and updates routing',
      async () => {
        const defaultSpace = await createDefaultSpace('T6175 default→byodb source');
        const byodbSpace = await createByodbSpace('T6175 default→byodb target');
        const base = await createBase({
          spaceId: defaultSpace.id,
          name: 'T6175 moving base',
        });
        basesToCleanup.push(base.id);

        const table: ITableFullVo = await createTable(base.id, {
          name: 'T6175 table',
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
          records: [{ fields: { Name: 'before-move' } }],
        });
        const primaryFieldId = table.fields.find((f) => f.isPrimary)?.id;
        expect(primaryFieldId).toBeTruthy();

        await expect(tableExists(defaultDataDb, base.id)).resolves.toBe(true);
        await expect(tableExists(byodbDataDb, base.id)).resolves.toBe(false);

        const moveResult = (await moveBase(base.id, byodbSpace.id)).data;
        expect(moveResult.async).toBe(true);
        expect(moveResult.jobId).toBeTruthy();

        const status = await waitForMoveJob(base.id, moveResult.jobId!);
        if (status.state !== 'succeeded') {
          throw new Error(
            `Move failed: state=${status.state} phase=${status.phase} error=${status.lastError}`
          );
        }

        await expect(tableExists(byodbDataDb, base.id)).resolves.toBe(true);
        await expect(tableExists(defaultDataDb, base.id)).resolves.toBe(false);

        const records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
        expect(records.data.records.length).toBeGreaterThanOrEqual(1);
        expect(records.data.records[0].fields[primaryFieldId!]).toBe('before-move');

        const postMove = await createRecords(table.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [{ fields: { [primaryFieldId!]: 'after-move' } }],
        });
        const newRecordId = postMove.records[0].id;

        const afterRecords = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
        expect(afterRecords.data.records.some((r) => r.id === newRecordId)).toBe(true);
      }
    );
  });
});
