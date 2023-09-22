/* eslint-disable @typescript-eslint/naming-convention */
import type { Provider } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from './prisma.service';

const PrismaProvider: Provider = {
  provide: PrismaService,
  inject: [ClsService],
  useFactory: async (cls: ClsService) => {
    return new PrismaService(cls);
  },
};

@Global()
@Module({
  providers: [PrismaProvider],
  exports: [PrismaProvider],
})
export class PrismaModule {}
