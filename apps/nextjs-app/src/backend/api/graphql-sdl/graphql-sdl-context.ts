import type { PrismaClientDbMain } from '@teable-group/db-main-prisma';
import { prismaClient } from '@/backend/config/container.config';

export type IGraphqlSdlContext = {
  prisma: PrismaClientDbMain;
};

export const graphqlSdlContext: IGraphqlSdlContext = {
  prisma: prismaClient,
};
