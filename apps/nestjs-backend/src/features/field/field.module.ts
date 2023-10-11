import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { FieldSupplementService } from './field-supplement.service';
import { FieldService } from './field.service';

@Module({
  providers: [DbProvider, FieldService, FieldSupplementService, AttachmentsTableService],
  exports: [FieldService, FieldSupplementService],
})
export class FieldModule {}
