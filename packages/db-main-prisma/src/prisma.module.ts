/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Provider } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { getDatabaseUrl } from './database-url';
import { defaultPgPoolFactory, PG_POOL_FACTORY, PgPoolRegistry } from './pg-pool-registry';
import { DataPrismaService, MetaPrismaService, PrismaService } from './prisma.service';

const getSchema = (databaseUrl: string): string | undefined =>
  new URL(databaseUrl).searchParams.get('schema') ?? undefined;

export const MetaPrismaProvider: Provider = {
  provide: MetaPrismaService,
  useFactory: async (cls: ClsService<any>, registry: PgPoolRegistry) => {
    const databaseUrl = getDatabaseUrl('meta');
    return new MetaPrismaService(cls, registry.acquire(databaseUrl), getSchema(databaseUrl));
  },
  inject: [ClsService, PgPoolRegistry],
};

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL_FACTORY,
      useValue: defaultPgPoolFactory,
    },
    PgPoolRegistry,
    MetaPrismaProvider,
    {
      provide: PrismaService,
      useExisting: MetaPrismaService,
    },
  ],
  exports: [MetaPrismaProvider, PrismaService, PgPoolRegistry],
})
export class PrismaModule {}

export const DataPrismaProvider: Provider = {
  provide: DataPrismaService,
  useFactory: async (cls: ClsService<any>, registry: PgPoolRegistry) => {
    const databaseUrl = getDatabaseUrl('data');
    return new DataPrismaService(cls, registry.acquire(databaseUrl), getSchema(databaseUrl));
  },
  inject: [ClsService, PgPoolRegistry],
};

@Global()
@Module({
  providers: [DataPrismaProvider],
  exports: [DataPrismaProvider],
})
export class DataPrismaModule {}
