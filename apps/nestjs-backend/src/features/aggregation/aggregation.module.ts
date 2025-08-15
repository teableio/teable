import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { RecordQueryBuilderModule } from '../record/query-builder';
import { RecordPermissionService } from '../record/record-permission.service';
import { RecordModule } from '../record/record.module';
import { TableIndexService } from '../table/table-index.service';
import { AggregationServiceV2 } from './aggregation-v2.service';
import { AggregationService } from './aggregation.service';
import { AGGREGATION_SERVICE_SYMBOL } from './aggregation.service.symbol';

@Module({
  imports: [RecordModule, RecordQueryBuilderModule],
  providers: [
    DbProvider,
    TableIndexService,
    RecordPermissionService,
    AggregationService,
    AggregationServiceV2,
    {
      provide: AGGREGATION_SERVICE_SYMBOL,
      useClass: AggregationService, // Default to V1 implementation
    },
  ],
  exports: [AGGREGATION_SERVICE_SYMBOL, AggregationService, AggregationServiceV2],
})
export class AggregationModule {}
