import { Global, Module } from '@nestjs/common';
import { PrismaModule, PrismaService } from '@teable-group/db-main-prisma';
import { TeableKnexModule } from './knex';

@Global()
@Module({
  imports: [TeableKnexModule.register(), PrismaModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class GlobalModule {}
