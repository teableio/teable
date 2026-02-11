import { Module } from '@nestjs/common';
import { ExportMetricsService } from './export-metrics.service';

@Module({
  providers: [ExportMetricsService],
  exports: [ExportMetricsService],
})
export class ExportMetricsModule {}
