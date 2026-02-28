import { Module } from '@nestjs/common';
import { ImportMetricsService } from './import-metrics.service';
import { ImportTracingService } from './import-tracing.service';

@Module({
  providers: [ImportMetricsService, ImportTracingService],
  exports: [ImportMetricsService, ImportTracingService],
})
export class ImportMetricsModule {}
