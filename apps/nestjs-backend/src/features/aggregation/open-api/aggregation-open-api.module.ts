import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { AggregationModule } from '../aggregation.module';
import { AggregationOpenApiController } from './aggregation-open-api.controller';
import { AggregationOpenApiService } from './aggregation-open-api.service';

@Module({
  controllers: [AggregationOpenApiController],
  imports: [AggregationModule],
  providers: [AggregationOpenApiService, PrismaService],
  exports: [AggregationOpenApiService],
})
export class AggregationOpenApiModule {}
