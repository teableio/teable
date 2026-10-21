import { Module } from '@nestjs/common';
import { TableQueryObservationRuntimeModule } from '../v2/table-query-observation-runtime.module';
import { BaseSqlExecutorService } from './base-sql-executor.service';
@Module({
  imports: [TableQueryObservationRuntimeModule],
  providers: [BaseSqlExecutorService],
  exports: [BaseSqlExecutorService],
})
export class BaseSqlExecutorModule {}
