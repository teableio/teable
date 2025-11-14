import { Module } from '@nestjs/common';
import { MetricsModule } from '../../observability/metrics/metrics.module';
import { CacheMetricsService } from './metrics.service';

@Module({
  imports: [MetricsModule],
  providers: [CacheMetricsService],
  exports: [CacheMetricsService],
})
export class CacheMetricsModule {}
