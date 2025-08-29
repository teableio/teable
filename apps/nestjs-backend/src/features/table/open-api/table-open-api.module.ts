import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { FieldCalculateModule } from '../../field/field-calculate/field-calculate.module';
import { FieldDuplicateModule } from '../../field/field-duplicate/field-duplicate.module';
import { FieldOpenApiModule } from '../../field/open-api/field-open-api.module';
import { GraphModule } from '../../graph/graph.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordModule } from '../../record/record.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { TableDuplicateService } from '../table-duplicate.service';
import { TableIndexService } from '../table-index.service';
import { TableModule } from '../table.module';
import { TableController } from './table-open-api.controller';
import { TableOpenApiService } from './table-open-api.service';

@Module({
  imports: [
    FieldCalculateModule,
    RecordModule,
    RecordOpenApiModule,
    ViewOpenApiModule,
    FieldOpenApiModule,
    FieldDuplicateModule,
    TableModule,
    ShareDbModule,
    CalculationModule,
    GraphModule,
  ],
  controllers: [TableController],
  providers: [DbProvider, TableOpenApiService, TableIndexService, TableDuplicateService],
  exports: [TableOpenApiService],
})
export class TableOpenApiModule {}
