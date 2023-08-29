import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../share-db/share-db.module';
import { AggregationService } from './aggregation.service';
import { AggregationListener } from './listeners/aggregation.listener';

@Module({
  imports: [ShareDbModule],
  providers: [AggregationService, AggregationListener],
  exports: [AggregationService],
})
export class AggregationModule {}
