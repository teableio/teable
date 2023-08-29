import { Module } from '@nestjs/common';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { FieldSupplementService } from './field-supplement.service';
import { FieldService } from './field.service';

@Module({
  providers: [FieldService, FieldSupplementService, AttachmentsTableService],
  exports: [FieldService, FieldSupplementService],
})
export class FieldModule {}
