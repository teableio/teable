import { PrismaService } from '@teable-group/db-main-prisma';
import * as bcrypt from 'bcrypt';
import { Config } from '@jest/types';
import { generateUserId } from '@teable-group/core';

interface TestConfig {
  email: string;
  password: string;
  spaceId: string;
  baseId: string;
}

declare global {
  var testConfig: TestConfig;
}

export default async (_globalConfig: Config.GlobalConfig, projectConfig: Config.ProjectConfig) => {
  const { email, password, spaceId, baseId } = projectConfig.globals.testConfig as TestConfig;

  const prismaService = new PrismaService();
  await prismaService.onModuleInit();

  const userId = generateUserId();
  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(password, salt);

  // init data exists
  const existsEmail = await prismaService.user.count({ where: { email } });
  const existsSpace = await prismaService.space.count({ where: { id: spaceId } });
  const existsBase = await prismaService.base.count({ where: { id: baseId } });

  await prismaService.$transaction(async (prisma) => {
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
