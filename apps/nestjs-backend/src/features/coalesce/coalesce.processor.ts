import { WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { NestWorkerOptions } from '../../utils/nest-worker-options';
import { Processor } from '../../utils/queue-processor';
import { COALESCE_QUEUE, CoalesceService, type ICoalesceFlushJob } from './coalesce.service';

const queueOptions: NestWorkerOptions = {
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
};

@Injectable()
@Processor(COALESCE_QUEUE, queueOptions)
export class CoalesceProcessor extends WorkerHost {
  constructor(private readonly coalesceService: CoalesceService) {
    super();
  }

  async process(job: Job<ICoalesceFlushJob>) {
    await this.coalesceService.flush(job.data, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
  }
}
