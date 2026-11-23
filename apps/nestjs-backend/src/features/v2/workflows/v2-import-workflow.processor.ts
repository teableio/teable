import { WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Processor } from '../../../utils/queue-processor';
import { V2WorkflowService } from './v2-workflow.service';
import {
  V2_IMPORT_WORKFLOW_QUEUE,
  type IV2ImportWorkflowJob,
  type IV2ImportWorkflowProgress,
} from './v2-import-workflow.types';

@Injectable()
@Processor(V2_IMPORT_WORKFLOW_QUEUE, { concurrency: 1, maxStalledCount: 0 })
export class V2ImportWorkflowProcessor extends WorkerHost {
  constructor(private readonly workflows: V2WorkflowService) { super(); }

  async process(job: Job<IV2ImportWorkflowJob, IV2ImportWorkflowProgress>) {
    // Native imports commit batches. Never replay a partially committed non-idempotent job.
    if (job.attemptsStarted > 1) throw new Error('Interrupted imports require a new explicit request');
    return this.workflows.executeImport(job);
  }
}
