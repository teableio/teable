import { Module } from '@nestjs/common';
import { RecordModule } from '../../record/record.module';
import { AggregationModule } from '../aggregation.module';
import { AggregationOpenApiController } from './aggregation-open-api.controller';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Module({
  controllers: [AggregationOpenApiController],
  imports: [AggregationModule, RecordModule],
  providers: [AggregationOpenApiService],
  exports: [AggregationOpenApiService],
})
export class AggregationOpenApiModule {}
