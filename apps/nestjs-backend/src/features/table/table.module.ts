import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FieldModule } from '../field/field.module';
import { FieldOpenApiModule } from '../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../record/open-api/record-open-api.module';
import { RecordModule } from '../record/record.module';
import { ViewModule } from '../view/view.module';
import { TableController } from './table.controller';
import { TableService } from './table.service';

@Module({
  imports: [ViewModule, FieldModule, RecordModule, FieldOpenApiModule, RecordOpenApiModule],
  controllers: [TableController],
  providers: [TableService, PrismaService],
})
export class TableModule {}
