import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FieldSupplementService } from './field-supplement.service';
import { FieldService } from './field.service';
import { AttachmentsTableService } from '../attachments/attachments-table.service';

@Module({
  providers: [FieldService, FieldSupplementService, PrismaService, AttachmentsTableService],
  exports: [FieldService, FieldSupplementService, PrismaService],
})
export class FieldModule {}
