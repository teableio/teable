import { Module } from '@nestjs/common';
import { PerformanceCacheModule } from '../../../performance-cache';
import { AggregationModule } from '../aggregation.module';
import { AggregationOpenApiController } from './aggregation-open-api.controller';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Module({
  controllers: [AggregationOpenApiController],
  imports: [AggregationModule, PerformanceCacheModule],
  providers: [AggregationOpenApiService],
  exports: [AggregationOpenApiService],
})
export class AggregationOpenApiModule {}
