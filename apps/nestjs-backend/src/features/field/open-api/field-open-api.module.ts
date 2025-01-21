import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { GraphModule } from '../../graph/graph.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordModule } from '../../record/record.module';
import { TableIndexService } from '../../table/table-index.service';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { FieldCalculateModule } from '../field-calculate/field-calculate.module';
import { FieldModule } from '../field.module';
import { FieldOpenApiController } from './field-open-api.controller';
import { FieldOpenApiService } from './field-open-api.service';

@Module({
  imports: [
    FieldModule,
    RecordModule,
    ViewOpenApiModule,
    ShareDbModule,
    CalculationModule,
    RecordOpenApiModule,
    FieldCalculateModule,
    ViewModule,
    GraphModule,
  ],
  controllers: [FieldOpenApiController],
  providers: [DbProvider, FieldOpenApiService, TableIndexService],
  exports: [FieldOpenApiService],
})
export class FieldOpenApiModule {}
