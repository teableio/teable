import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ShareDbModule } from '../../share-db/share-db.module';
import { AggregationService } from './aggregation.service';
import { AggregationListener } from './listeners/aggregation.listener';

@Module({
  imports: [ShareDbModule],
  providers: [AggregationService, PrismaService, AggregationListener],
  exports: [AggregationService],
})
export class AggregationModule {}
