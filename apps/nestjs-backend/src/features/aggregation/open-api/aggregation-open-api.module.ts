import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { AggregationModule } from '../aggregation.module';
import { AggregationListener } from '../listeners/aggregation.listener';
import { AggregationOpenApiController } from './aggregation-open-api.controller';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Module({
  controllers: [AggregationOpenApiController],
  imports: [AggregationModule, ShareDbModule],
  providers: [AggregationOpenApiService, AggregationListener],
  exports: [AggregationOpenApiService],
})
export class AggregationOpenApiModule {}
