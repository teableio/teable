import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FieldModule } from '../field/field.module';
import { RecordModule } from '../record/record.module';
import { ViewModule } from '../view/view.module';
import { TableService } from './table.service';

@Module({
  imports: [FieldModule, RecordModule, ViewModule],
  providers: [TableService, PrismaService],
  exports: [FieldModule, RecordModule, ViewModule, TableService],
})
export class TableModule {}
