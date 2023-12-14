import type { Config } from '@jest/types';
import { PrismaClient } from '@prisma/client';
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

export default async (_globalConfig: Config.GlobalConfig, projectConfig: Config.ProjectConfig) => {
  console.log('node-env', process.env.NODE_ENV);
  dotenv.config({ path: '../nextjs-app' });

  const { email, password, spaceId, baseId, userId } = projectConfig.globals
    .testConfig as ITestConfig;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const databaseUrl = process.env.PRISMA_DATABASE_URL!;

  console.log('database-url: ', databaseUrl);

  const { driver } = parseDsn(databaseUrl);
  console.log('driver: ', driver);
  (projectConfig.globals.testConfig as ITestConfig).driver = driver;

  const prismaClient = new PrismaClient();

  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(password, salt);

  // init data exists
  const existsEmail = await prismaClient.user.count({ where: { email } });
  const existsSpace = await prismaClient.space.count({ where: { id: spaceId } });
  const existsBase = await prismaClient.base.count({ where: { id: baseId } });

  await prismaClient.$transaction(async (prisma) => {
    if (!existsEmail) {
      await prisma.user.create({
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
      await prisma.space.create({
        data: {
          id: spaceId,
          name: 'test space',
          createdBy: userId,
          lastModifiedBy: userId,
        },
      });

      await prisma.collaborator.create({
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
        await prisma.$executeRawUnsafe(`create schema if not exists "${baseId}"`);
        await prisma.$executeRawUnsafe(`revoke all on schema "${baseId}" from public`);
      }
      await prisma.base.create({
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
  });
};
