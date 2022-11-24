import type { PrismaClientDbMain } from '@teable-group/db-main-prisma';
import { prismaClient } from '@/_backend/config/container.config';

export type GraphqlSdlContext = {
  prisma: PrismaClientDbMain;
};

export const graphqlSdlContext: GraphqlSdlContext = {
  prisma: prismaClient,
};
