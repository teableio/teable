/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Provider } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { DataPrismaService, MetaPrismaService, PrismaService } from './prisma.service';

export const MetaPrismaProvider: Provider = {
  provide: MetaPrismaService,
  useFactory: async (cls: ClsService<any>) => {
    return new MetaPrismaService(cls);
  },
  inject: [ClsService],
};

@Global()
@Module({
  providers: [
    MetaPrismaProvider,
    {
      provide: PrismaService,
      useExisting: MetaPrismaService,
    },
  ],
  exports: [MetaPrismaProvider, PrismaService],
})
export class PrismaModule {}

export const DataPrismaProvider: Provider = {
  provide: DataPrismaService,
  useFactory: async (cls: ClsService<any>) => {
    return new DataPrismaService(cls);
  },
  inject: [ClsService],
};

@Global()
@Module({
  providers: [DataPrismaProvider],
  exports: [DataPrismaProvider],
})
export class DataPrismaModule {}
