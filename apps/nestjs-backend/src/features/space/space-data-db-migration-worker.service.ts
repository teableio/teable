import { hostname } from 'os';
import { Injectable, Logger } from '@nestjs/common';
import { SpaceDataDbMigrationService } from './space-data-db-migration.service';

type ISpaceDataDbMigrationWorkerRunResult = {
  jobId: string;
  status: 'succeeded' | 'failed';
  error?: string;
};

const defaultPollMs = 5000;
const defaultErrorBackoffMs = 10000;

const readPositiveIntegerEnv = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class SpaceDataDbMigrationWorkerService {
  private readonly logger = new Logger(SpaceDataDbMigrationWorkerService.name);
  private stopped = false;

  constructor(private readonly migrationService: SpaceDataDbMigrationService) {}

  stop() {
    this.stopped = true;
  }

  async runOnce(): Promise<ISpaceDataDbMigrationWorkerRunResult | null> {
    const workerId = this.getWorkerId();
    const recoveredJobs = await this.migrationService.recoverStaleActiveMigrationJobs(workerId);
    for (const job of recoveredJobs) {
      this.logger.warn(
        `Recovered stale BYODB space data DB migration job ${job.jobId} from ${job.state}: ${job.lastError}`
      );
    }
    const claimedJob = await this.migrationService.claimNextPendingMigrationJob(workerId);

    if (!claimedJob) {
      return null;
    }

    try {
      this.logger.log(`Running BYODB space data DB migration job ${claimedJob.jobId}`);
      await this.migrationService.runMigrationJob(claimedJob.jobId);
      this.logger.log(`Completed BYODB space data DB migration job ${claimedJob.jobId}`);
      return { jobId: claimedJob.jobId, status: 'succeeded' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed BYODB space data DB migration job ${claimedJob.jobId}: ${message}`,
        error instanceof Error ? error.stack : undefined
      );
      return { jobId: claimedJob.jobId, status: 'failed', error: message };
    }
  }

  async runForever(options: { pollMs?: number; errorBackoffMs?: number } = {}) {
    this.stopped = false;
    const pollMs =
      options.pollMs ??
      readPositiveIntegerEnv('BYODB_SPACE_DATA_DB_MIGRATION_WORKER_POLL_MS', defaultPollMs);
    const errorBackoffMs =
      options.errorBackoffMs ??
      readPositiveIntegerEnv(
        'BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ERROR_BACKOFF_MS',
        defaultErrorBackoffMs
      );

    this.logger.log(
      `BYODB space data DB migration worker ${this.getWorkerId()} started; pollMs=${pollMs}`
    );

    while (!this.stopped) {
      try {
        const result = await this.runOnce();
        if (!result) {
          await delay(pollMs);
        } else if (result.status === 'failed') {
          await delay(errorBackoffMs);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `BYODB space data DB migration worker loop failed: ${message}`,
          error instanceof Error ? error.stack : undefined
        );
        await delay(errorBackoffMs);
      }
    }

    this.logger.log(`BYODB space data DB migration worker ${this.getWorkerId()} stopped`);
  }

  private getWorkerId() {
    return process.env.BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ID ?? `${hostname()}:${process.pid}`;
  }
}
