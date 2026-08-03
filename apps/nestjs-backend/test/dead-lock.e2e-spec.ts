/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILookupOptionsRo } from '@teable/core';
import { DriverClient, FieldType, Relationship } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { retryOnDeadlock } from '../src/utils/retry-decorator';
import {
  createBase,
  createField,
  createRecords,
  createSpace,
  createTable,
  deleteBase,
  deleteSpace,
  getField,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

const deadLockTableA = 'dead_lock_a';
const deadLockTableB = 'dead_lock_b';
const deadLockTableARecordId = 'dead_lock_a_record_id';
const deadLockTableBRecordId = 'dead_lock_b_record_id';

class DeadLockService {
  async transaction1(prismaService: PrismaService) {
    await prismaService.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`
          UPDATE ${deadLockTableA} SET name = 'A1' WHERE id = '${deadLockTableARecordId}'
        `);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        await tx.$executeRawUnsafe(`
          UPDATE ${deadLockTableB} SET name = 'B1' WHERE id = '${deadLockTableBRecordId}'
          `);
      },
      {
        timeout: 5000,
      }
    );
  }

  async transaction2(prismaService: PrismaService) {
    await prismaService.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`
          UPDATE ${deadLockTableB} SET name = 'B2' WHERE id = '${deadLockTableBRecordId}'
        `);

        await new Promise((resolve) => setTimeout(resolve, 1000));

        await tx.$executeRawUnsafe(`
          UPDATE ${deadLockTableA} SET name = 'A2' WHERE id = '${deadLockTableARecordId}'
        `);
      },
      {
        timeout: 5000,
      }
    );
  }

  @retryOnDeadlock()
  async retryTransaction1(prismaService: PrismaService) {
    await this.transaction1(prismaService);
  }

  @retryOnDeadlock()
  async retryTransaction2(prismaService: PrismaService) {
    await this.transaction2(prismaService);
  }

  async createDeadlock(prismaService: PrismaService) {
    await Promise.all([this.transaction1(prismaService), this.transaction2(prismaService)]);
  }

  async createDeadlockWithRetry(prismaService: PrismaService) {
    await Promise.all([
      this.retryTransaction1(prismaService),
      this.retryTransaction2(prismaService),
    ]);
  }
}

describe.skipIf(globalThis.testConfig.driver !== DriverClient.Pg)('DeadLock', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  const deadLockService = new DeadLockService();

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prismaService = app.get(PrismaService);
    await prismaService.$executeRawUnsafe(`
      CREATE TABLE ${deadLockTableA} (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      )
    `);
    await prismaService.$executeRawUnsafe(`
      INSERT INTO ${deadLockTableA} (id, name) VALUES ('${deadLockTableARecordId}', 'A')
    `);
    await prismaService.$executeRawUnsafe(`
      CREATE TABLE ${deadLockTableB} (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      )
    `);
    await prismaService.$executeRawUnsafe(`
      INSERT INTO ${deadLockTableB} (id, name) VALUES ('${deadLockTableBRecordId}', 'B')
    `);
  });

  afterAll(async () => {
    await prismaService.$executeRawUnsafe(`
      DROP TABLE ${deadLockTableA}
    `);
    await prismaService.$executeRawUnsafe(`
      DROP TABLE ${deadLockTableB}
    `);
    await app.close();
  });

  it('should throw error when dead lock', async () => {
    const result = await new Promise((resolve) => {
      deadLockService
        .createDeadlock(prismaService)
        .then(resolve)
        .catch((e) => {
          resolve(e);
        });
    });
    expect(result).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((result as Prisma.PrismaClientKnownRequestError).meta?.code).toBe('40P01');
  });

  it('should retry when dead lock', async () => {
    await deadLockService.createDeadlockWithRetry(prismaService);
  });

  describe('record updates via API', () => {
    let spaceId: string;
    let baseId: string;
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;

    beforeEach(async () => {
      const space = await createSpace({ name: `deadlock-space-${Date.now()}` });
      spaceId = space.id;
      const base = await createBase({ name: `deadlock-base-${Date.now()}`, spaceId });
      baseId = base.id;
      tableA = await createTable(baseId, { name: 'deadlock-table-a' });
      tableB = await createTable(baseId, { name: 'deadlock-table-b' });
    });

    afterEach(async () => {
      if (baseId && tableA) {
        await permanentDeleteTable(baseId, tableA.id);
      }
      if (baseId && tableB) {
        await permanentDeleteTable(baseId, tableB.id);
      }
      if (baseId) {
        await deleteBase(baseId);
        await permanentDeleteBase(baseId);
      }
      if (spaceId) {
        await deleteSpace(spaceId);
        await permanentDeleteSpace(spaceId);
      }
    });

    it('should avoid deadlock when cross-table lookups recompute concurrently', async () => {
      const alphaTextField = await createField(tableA.id, {
        name: 'alpha-text',
        type: FieldType.SingleLineText,
      });
      const betaTextField = await createField(tableB.id, {
        name: 'beta-text',
        type: FieldType.SingleLineText,
      });

      const linkFieldRo: IFieldRo = {
        name: 'alpha-to-beta',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: tableB.id,
        },
      };
      const linkFieldA = await createField(tableA.id, linkFieldRo);
      const symmetricFieldId = (linkFieldA.options as { symmetricFieldId?: string })
        .symmetricFieldId;
      expect(symmetricFieldId).toBeTruthy();
      const linkFieldB = await getField(tableB.id, symmetricFieldId as string);

      const lookupOnA = await createField(tableA.id, {
        name: 'beta-lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tableB.id,
          linkFieldId: linkFieldA.id,
          lookupFieldId: betaTextField.id,
        } as ILookupOptionsRo,
      });
      expect(lookupOnA).toBeDefined();

      const lookupOnB = await createField(tableB.id, {
        name: 'alpha-lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: tableA.id,
          linkFieldId: linkFieldB.id,
          lookupFieldId: alphaTextField.id,
        } as ILookupOptionsRo,
      });
      expect(lookupOnB).toBeDefined();

      const alphaRecords = await createRecords(tableA.id, {
        records: [{ fields: { [alphaTextField.id]: 'Alpha initial' } }],
      });
      const betaRecords = await createRecords(tableB.id, {
        records: [{ fields: { [betaTextField.id]: 'Beta initial' } }],
      });
      const alphaRecordId = alphaRecords.records[0].id;
      const betaRecordId = betaRecords.records[0].id;

      await updateRecordByApi(tableA.id, alphaRecordId, linkFieldA.id, [{ id: betaRecordId }]);

      const iterations = 5;
      for (let i = 0; i < iterations; i++) {
        const alphaValue = `alpha-updated-${i}-${Date.now()}`;
        const betaValue = `beta-updated-${i}-${Date.now()}`;
        const results = await Promise.allSettled([
          updateRecordByApi(tableA.id, alphaRecordId, alphaTextField.id, alphaValue),
          updateRecordByApi(tableB.id, betaRecordId, betaTextField.id, betaValue),
        ]);
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(rejected).toHaveLength(0);
      }
    }, 20000);
  });
});
