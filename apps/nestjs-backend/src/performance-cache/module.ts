import { Global, Module } from '@nestjs/common';
import { PerformanceCacheService } from './service';

@Global()
@Module({
  providers: [PerformanceCacheService],
  exports: [PerformanceCacheService],
})
export class PerformanceCacheModule {}
