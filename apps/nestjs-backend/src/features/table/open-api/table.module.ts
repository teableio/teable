import { Module } from '@nestjs/common';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { TableModule } from '../table.module';
import { TableController } from './table.controller';

@Module({
  imports: [FieldOpenApiModule, RecordOpenApiModule, ViewOpenApiModule, TableModule],
  controllers: [TableController],
})
export class TableOpenApiModule {}
