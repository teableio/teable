import { Global, Module } from '@nestjs/common';
import { CacheMetricsModule } from './cache-metrics/metrics.module';
import { PerformanceCacheService } from './service';

@Global()
@Module({
  imports: [CacheMetricsModule],
  providers: [PerformanceCacheService],
  exports: [PerformanceCacheService],
})
export class PerformanceCacheModule {}
