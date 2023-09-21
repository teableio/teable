import type { Provider } from '@nestjs/common';
import { Global, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from './prisma.service';

export const prismaProvider: Provider = {
  provide: PrismaService,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useFactory: async (cls: ClsService<any>) => {
    return new PrismaService(cls);
  },
  inject: [ClsService],
};

@Global()
@Module({
  providers: [prismaProvider],
  exports: [prismaProvider],
})
export class PrismaModule {}
