import { Module } from '@nestjs/common';
import { PrismaModule } from '@teable-group/db-main-prisma';
import { AttachmentsTableService } from '../attachments/attachments-table.service';
import { FieldSupplementService } from './field-supplement.service';
import { FieldService } from './field.service';

@Module({
  imports: [PrismaModule],
  providers: [FieldService, FieldSupplementService, AttachmentsTableService],
  exports: [FieldService, FieldSupplementService],
})
export class FieldModule {}
