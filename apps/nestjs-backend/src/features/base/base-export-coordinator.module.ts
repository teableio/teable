import { Module } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { BaseExportCoordinator } from './base-export-coordinator';

// CE and EE exporters share this provider rather than owning independent admission slots.
@Module({
  providers: [
    {
      provide: BaseExportCoordinator,
      inject: [CacheService],
      useFactory: (cacheService: CacheService) => new BaseExportCoordinator(cacheService),
    },
  ],
  exports: [BaseExportCoordinator],
})
export class BaseExportCoordinatorModule {}
