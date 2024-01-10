import { Prisma, PrismaClient } from '@prisma/client';
import { DriverClient, parseDsn } from '@teable-group/core';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv-flow';

interface ITestConfig {
  driver: string;
  email: string;
  userId: string;
  password: string;
  spaceId: string;
  baseId: string;
}

declare global {
  // eslint-disable-next-line no-var
  var testConfig: ITestConfig;
}

// Set global variables (if needed)
globalThis.testConfig = {
  email: 'test@e2e.com',
  password: '12345678',
  userId: 'usrTestUserId',
  spaceId: 'spcTestSpaceId',
  baseId: 'bseTestBaseId',
  driver: DriverClient.Sqlite,
};

async function setup() {
  console.log('node-env', process.env.NODE_ENV);
  dotenv.config({ path: '../nextjs-app' });

  const { email, password, spaceId, baseId, userId } = globalThis.testConfig;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const databaseUrl = process.env.PRISMA_DATABASE_URL!;

  console.log('database-url: ', databaseUrl);
  const { driver } = parseDsn(databaseUrl);
  console.log('driver: ', driver);
  globalThis.testConfig.driver = driver;

  const prisma = new PrismaClient();

  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(password, salt);

  // init data exists
  await prisma.$transaction(
    async (tx) => {
      const existsEmail = await tx.user.findFirst({ where: { email } });
      const existsSpace = await tx.space.findFirst({ where: { id: spaceId } });
      const existsBase = await tx.base.findFirst({ where: { id: baseId } });
      if (!existsEmail) {
        await tx.user.create({
          data: {
            id: userId,
            name: email.split('@')[0],
            email,
            salt,
            password: hashPassword,
          },
        });
      }
      if (!existsSpace) {
        await tx.space.create({
          data: {
            id: spaceId,
            name: 'test space',
            createdBy: userId,
            lastModifiedBy: userId,
          },
        });

        await tx.collaborator.create({
          data: {
            spaceId,
            roleName: 'owner',
            userId,
            createdBy: userId,
            lastModifiedBy: userId,
          },
        });
      }
      if (!existsBase) {
        if (driver !== DriverClient.Sqlite) {
          await tx.$executeRawUnsafe(`create schema if not exists "${baseId}"`);
          await tx.$executeRawUnsafe(`revoke all on schema "${baseId}" from public`);
        }
        await tx.base.create({
          data: {
            id: baseId,
            spaceId,
            name: 'test base',
            order: 1,
            createdBy: userId,
            lastModifiedBy: userId,
          },
        });
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }
  );
}

export default setup();
