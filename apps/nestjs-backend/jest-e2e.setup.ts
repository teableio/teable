import type { Config } from '@jest/types';
import { PrismaClient } from '@prisma/client';
import { generateUserId } from '@teable-group/core';
import * as bcrypt from 'bcrypt';

interface ITestConfig {
  email: string;
  password: string;
  spaceId: string;
  baseId: string;
}

declare global {
  // eslint-disable-next-line no-var
  var testConfig: ITestConfig;
}

export default async (_globalConfig: Config.GlobalConfig, projectConfig: Config.ProjectConfig) => {
  const { email, password, spaceId, baseId } = projectConfig.globals.testConfig as ITestConfig;

  const prismaClient = new PrismaClient();

  const userId = generateUserId();
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
          id: generateUserId(),
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
    }
    if (!existsBase) {
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
