import execa from 'execa';
import type { Options as ExecaOptions } from 'execa';
import { PrismaManager, PrismaClientDbMain } from '../../src';
import { getAndCheckDatabaseDsn } from '../e2e-dsn-services.util';

describe('prisma cli commands', () => {
  let databaseDsn = '';
  beforeAll(async () => {
    databaseDsn = await getAndCheckDatabaseDsn();
  });
  describe('yarn prisma db create and seed', () => {
    it('should load seed data in a newly created db', async () => {
      const dsn = databaseDsn;

      const options: ExecaOptions = {
        // encoding: 'utf-8',
        shell: true,
        env: {
          ...process.env,
          PRISMA_DATABASE_URL: dsn,
        },
      };

      const createResult = await execa('yarn prisma db push', options);

      expect(createResult.exitCode).toStrictEqual(0);
      expect(createResult.stdout).toMatch(/your database is now in sync/i);

      const seedResult = await execa('yarn prisma db seed', options);

      expect(seedResult.exitCode).toStrictEqual(0);
      expect(seedResult.stdout).toMatch(/seeding finished/i);

      const prisma = PrismaManager.getDevSafeInstance('test', () => {
        return new PrismaClientDbMain({
          datasources: {
            db: {
              url: dsn,
            },
          },
        });
      });

      const poetry = await prisma.poem.findFirst();
      expect(poetry).toBeDefined();
    });
  });
});
