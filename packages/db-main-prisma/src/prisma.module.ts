/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Provider } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from './prisma.service';

export const PrismaProvider: Provider = {
  provide: PrismaService,
  useFactory: async (cls: ClsService<any>) => {
    return new PrismaService(cls);
  },
  inject: [ClsService],
};

@Global()
@Module({
  providers: [PrismaProvider],
  exports: [PrismaProvider],
})
export class PrismaModule {}
