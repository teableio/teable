import { Module } from '@nestjs/common';
import { CacheMetricsService } from './metrics.service';

@Module({
  providers: [CacheMetricsService],
  exports: [CacheMetricsService],
})
export class CacheMetricsModule {}
