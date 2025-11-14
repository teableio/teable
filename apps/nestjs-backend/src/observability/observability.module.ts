import { Module } from '@nestjs/common';
import { ProfilerModule } from './profiling/profiler.module';
@Module({
  imports: [ProfilerModule],
})
export class ObservabilityModule {}
