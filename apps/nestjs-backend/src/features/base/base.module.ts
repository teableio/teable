import { Module } from '@nestjs/common';
import { RecordModule } from '../record/record.module';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';

@Module({
  imports: [RecordModule],
  controllers: [BaseController],
  providers: [BaseService],
})
export class BaseModule {}
