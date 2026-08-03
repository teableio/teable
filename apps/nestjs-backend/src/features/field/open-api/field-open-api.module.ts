import { Module } from '@nestjs/common';
import { DbProvider } from '../../../db-provider/db.provider';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { CalculationModule } from '../../calculation/calculation.module';
import { CanaryModule } from '../../canary/canary.module';
import { GraphModule } from '../../graph/graph.module';
import { ComputedModule } from '../../record/computed/computed.module';
import { RecordOpenApiModule } from '../../record/open-api/record-open-api.module';
import { RecordQueryBuilderModule } from '../../record/query-builder';
import { RecordModule } from '../../record/record.module';
import { TableIndexService } from '../../table/table-index.service';
import { V2Module } from '../../v2/v2.module';
import { ViewOpenApiModule } from '../../view/open-api/view-open-api.module';
import { ViewModule } from '../../view/view.module';
import { FieldCalculateModule } from '../field-calculate/field-calculate.module';
import { FieldModule } from '../field.module';
import { FieldOpenApiController } from './field-open-api.controller';
import { FieldOpenApiV2Service } from './field-open-api-v2.service';
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
    RecordQueryBuilderModule,
    ComputedModule,
    V2Module,
    CanaryModule,
  ],
  controllers: [FieldOpenApiController],
  providers: [DbProvider, FieldOpenApiService, FieldOpenApiV2Service, TableIndexService],
  exports: [FieldOpenApiService, FieldOpenApiV2Service],
})
export class FieldOpenApiModule {}
