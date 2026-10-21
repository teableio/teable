import { Module } from '@nestjs/common';
import { DataApiMetricsModule } from './data-api/data-api-metrics.module';
import { DatabaseHealthModule } from './database-health/database-health.module';
import { ProfilerModule } from './profiling/profiler.module';
@Module({
  imports: [ProfilerModule, DataApiMetricsModule, DatabaseHealthModule],
})
export class ObservabilityModule {}
