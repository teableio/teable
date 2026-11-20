import { Module } from '@nestjs/common';
import { V2Module } from '../../v2/v2.module';
import { AggregationOpenApiV2Service } from './aggregation-open-api-v2.service';

@Module({
  imports: [V2Module],
  providers: [AggregationOpenApiV2Service],
  exports: [AggregationOpenApiV2Service],
})
export class AggregationOpenApiV2Module {}
