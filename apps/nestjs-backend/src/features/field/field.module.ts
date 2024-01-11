import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsTableModule } from '../attachments/attachments-table.module';
import { CalculationModule } from '../calculation/calculation.module';
import { FieldService } from './field.service';

@Module({
  imports: [CalculationModule, AttachmentsTableModule],
  providers: [FieldService, DbProvider],
  exports: [FieldService],
})
export class FieldModule {}
