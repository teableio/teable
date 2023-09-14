import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable-group/db-main-prisma';
import { RecordModule } from '../record/record.module';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';

@Module({
  imports: [PrismaModule, RecordModule],
  controllers: [BaseController],
  providers: [BaseService],
})
export class BaseModule {}
