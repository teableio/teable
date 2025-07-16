/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import { DriverClient } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';
import { retryOnDeadlock } from '../src/utils/retry-decorator';
import { initApp } from './utils/init-app';

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
});
