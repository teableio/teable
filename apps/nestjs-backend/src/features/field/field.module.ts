import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsModule } from '../attachments/attachments.module';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldService } from './field.service';

@Module({
  imports: [CalculationModule, AttachmentsModule],
  providers: [FieldService, DbProvider],
  exports: [FieldService],
})
export class FieldModule {}
