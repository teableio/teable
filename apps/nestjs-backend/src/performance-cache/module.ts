import { Module } from '@nestjs/common';
import { PerformanceCacheService } from './service';

@Module({
  providers: [PerformanceCacheService],
  exports: [PerformanceCacheService],
})
export class PerformanceCacheModule {}
