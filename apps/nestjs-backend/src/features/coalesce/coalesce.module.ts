import { Module } from '@nestjs/common';
import { DistributedLockModule } from '../../distributed-lock';
import { EventJobModule } from '../../event-emitter/event-job/event-job.module';
import { COALESCE_QUEUE, CoalesceService } from './coalesce.service';

@Module({
  imports: [DistributedLockModule, EventJobModule.registerQueue(COALESCE_QUEUE)],
  providers: [CoalesceService],
  exports: [CoalesceService],
})
export class CoalesceModule {}
