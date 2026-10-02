import { Module } from '@nestjs/common';
import { CanaryModule } from '../../canary/canary.module';
import { RecordModule } from '../../record/record.module';
import { SpaceDataDbMigrationGuardModule } from '../../space/space-data-db-migration-guard.module';
import { TableQuerySearchVectorRuntimeService } from '../../v2/table-query-search-vector-runtime.service';
import { V2Module } from '../../v2/v2.module';
import { AggregationModule } from '../aggregation.module';
import { AggregationOpenApiV2Service } from './aggregation-open-api-v2.service';
import { AggregationOpenApiController } from './aggregation-open-api.controller';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Module({
  controllers: [AggregationOpenApiController],
  imports: [
    AggregationModule,
    CanaryModule,
    RecordModule,
    SpaceDataDbMigrationGuardModule,
    V2Module,
  ],
  providers: [
    AggregationOpenApiService,
    AggregationOpenApiV2Service,
    TableQuerySearchVectorRuntimeService,
  ],
  exports: [AggregationOpenApiService, AggregationOpenApiV2Service],
})
export class AggregationOpenApiModule {}
