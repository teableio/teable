import { Module } from '@nestjs/common';
import { CanaryModule } from '../../canary/canary.module';
import { RecordModule } from '../../record/record.module';
import { SpaceDataDbMigrationGuardModule } from '../../space/space-data-db-migration-guard.module';
import { AggregationModule } from '../aggregation.module';
import { AggregationOpenApiV2Module } from './aggregation-open-api-v2.module';
import { AggregationOpenApiController } from './aggregation-open-api.controller';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Module({
  controllers: [AggregationOpenApiController],
  imports: [
    AggregationModule,
    CanaryModule,
    RecordModule,
    SpaceDataDbMigrationGuardModule,
    AggregationOpenApiV2Module,
  ],
  providers: [AggregationOpenApiService],
  exports: [AggregationOpenApiService, AggregationOpenApiV2Module],
})
export class AggregationOpenApiModule {}
