import { Module } from '@nestjs/common';
import { RealtimeMetricsService } from './realtime-metrics.service';

@Module({
  providers: [RealtimeMetricsService],
  exports: [RealtimeMetricsService],
})
export class RealtimeMetricsModule {}
