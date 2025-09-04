import { Module } from '@nestjs/common';
import { CalculationModule } from '../calculation/calculation.module';
import { RecordQueryBuilderModule } from '../record/query-builder';
import { RecordModule } from '../record/record.module';
import { TableDomainQueryModule } from '../table-domain/table-domain-query.module';
import { RealtimeOpListener } from './realtime-op.listener';
import { RealtimeOpService } from './realtime-op.service';

@Module({
  imports: [RecordModule, CalculationModule, RecordQueryBuilderModule, TableDomainQueryModule],
  providers: [RealtimeOpService, RealtimeOpListener],
  exports: [RealtimeOpService],
})
export class RealtimeOpModule {}
