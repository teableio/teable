/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Provider } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { PgPoolRegistry, PrismaModule } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { getDataDatabaseUrl } from './database-url';
import { DataPrismaService } from './prisma.service';

const getSchema = (databaseUrl: string): string | undefined =>
  new URL(databaseUrl).searchParams.get('schema') ?? undefined;

export const DataPrismaProvider: Provider = {
  provide: DataPrismaService,
  useFactory: async (cls: ClsService<any>, registry: PgPoolRegistry) => {
    const databaseUrl = getDataDatabaseUrl();
    return new DataPrismaService(cls, registry.acquire(databaseUrl), getSchema(databaseUrl));
  },
  inject: [ClsService, PgPoolRegistry],
};

@Global()
@Module({
  imports: [PrismaModule],
  providers: [DataPrismaProvider],
  exports: [DataPrismaProvider],
})
export class DataPrismaModule {}
