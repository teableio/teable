import { Module } from '@nestjs/common';
import { TableQueryObservationRuntimeService } from './table-query-observation-runtime.service';

@Module({
  providers: [TableQueryObservationRuntimeService],
  exports: [TableQueryObservationRuntimeService],
})
export class TableQueryObservationRuntimeModule {}
