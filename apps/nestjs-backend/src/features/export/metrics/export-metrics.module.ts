import { Module } from '@nestjs/common';
import { ExportMetricsService } from './export-metrics.service';
import { ExportTracingService } from './export-tracing.service';

@Module({
  providers: [ExportMetricsService, ExportTracingService],
  exports: [ExportMetricsService, ExportTracingService],
})
export class ExportMetricsModule {}
