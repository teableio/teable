import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { TableModule } from '../table.module';
import { GraphService } from './graph.service';
import { TableController } from './table-open-api.controller';
import { TableOpenApiService } from './table-open-api.service';

@Module({
  imports: [
    FieldOpenApiModule,
    RecordOpenApiModule,
    ViewOpenApiModule,
    TableModule,
    ShareDbModule,
    CalculationModule,
  ],
  controllers: [TableController],
  providers: [TableOpenApiService, GraphService],
})
export class TableOpenApiModule {}
