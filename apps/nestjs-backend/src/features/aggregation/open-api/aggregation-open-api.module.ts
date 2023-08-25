import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { AggregationModule } from '../aggregation.module';
import { AggregationService } from '../aggregation.service';
import { AggregationOpenApiController } from './aggregation-open-api.controller';

@Module({
  controllers: [AggregationOpenApiController],
  imports: [AggregationModule],
  providers: [AggregationService, PrismaService],
  exports: [AggregationService],
})
export class AggregationOpenApiModule {}
