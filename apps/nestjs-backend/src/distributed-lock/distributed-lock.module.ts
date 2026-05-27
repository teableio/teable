import { Module } from '@nestjs/common';
import { DistributedLockService } from './distributed-lock.service';

/**
 * Provides {@link DistributedLockService}. Import it into any feature module
 * that needs to guard startup seeding or other once-per-deployment work.
 */
@Module({
  providers: [DistributedLockService],
  exports: [DistributedLockService],
})
export class DistributedLockModule {}
