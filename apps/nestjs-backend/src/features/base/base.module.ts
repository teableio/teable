import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { RecordModule } from '../record/record.module';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';

@Module({
  imports: [RecordModule],
  controllers: [BaseController],
  providers: [PrismaService, BaseService],
})
export class BaseModule {}
