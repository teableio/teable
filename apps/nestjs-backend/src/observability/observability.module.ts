import { Module } from '@nestjs/common';
import { DataApiMetricsModule } from './data-api/data-api-metrics.module';
import { ProfilerModule } from './profiling/profiler.module';
@Module({
  imports: [ProfilerModule, DataApiMetricsModule],
})
export class ObservabilityModule {}
