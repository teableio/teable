import { Module } from '@nestjs/common';
import { ImportMetricsService } from './import-metrics.service';

@Module({
  providers: [ImportMetricsService],
  exports: [ImportMetricsService],
})
export class ImportMetricsModule {}
