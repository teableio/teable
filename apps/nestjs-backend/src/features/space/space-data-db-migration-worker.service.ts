import { hostname } from 'os';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { SpaceDataDbMigrationService } from './space-data-db-migration.service';

type ISpaceDataDbMigrationWorkerRunResult = {
  jobId: string;
  status: 'succeeded' | 'failed';
  error?: string;
};

const enabledEnvKey = 'BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ENABLED';
const pollMsEnvKey = 'BYODB_SPACE_DATA_DB_MIGRATION_WORKER_POLL_MS';
const errorBackoffMsEnvKey = 'BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ERROR_BACKOFF_MS';
const workerIdEnvKey = 'BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ID';

const defaultPollMs = 5000;
const defaultErrorBackoffMs = 10000;

const parseBoolean = (value: unknown, defaultValue: boolean): boolean => {
  if (value == null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const readPositiveIntegerEnv = (key: string, fallback: number) => {
  const value = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
export class SpaceDataDbMigrationWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SpaceDataDbMigrationWorkerService.name);
  private stopped = false;
  private loopPromise: Promise<void> | undefined;

  constructor(private readonly migrationService: SpaceDataDbMigrationService) {}

  onApplicationBootstrap() {
    if (!this.isEnabled()) {
      this.logger.log('BYODB space data DB migration worker disabled');
      return;
    }

    this.stopped = false;
    this.loopPromise = this.runForever().catch((error) => {
      this.logger.error(
        `BYODB space data DB migration worker exited unexpectedly: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined
      );
    });
  }

  onModuleDestroy() {
    this.stop();
  }

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
    const pollMs = options.pollMs ?? readPositiveIntegerEnv(pollMsEnvKey, defaultPollMs);
    const errorBackoffMs =
      options.errorBackoffMs ?? readPositiveIntegerEnv(errorBackoffMsEnvKey, defaultErrorBackoffMs);

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

  /**
   * Await the in-process loop after stop(). Useful for tests that start the
   * bootstrap lifecycle explicitly.
   */
  async waitForStop() {
    await this.loopPromise;
  }

  private isEnabled() {
    // Tests drive jobs via runOnce(); keep the background loop off unless a
    // suite opts in explicitly.
    const isTestRuntime =
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true' ||
      Boolean(process.env.VITEST);
    if (isTestRuntime) {
      return parseBoolean(process.env[enabledEnvKey], false);
    }
    return parseBoolean(process.env[enabledEnvKey], true);
  }

  private getWorkerId() {
    return process.env[workerIdEnvKey] ?? `${hostname()}:${process.pid}`;
  }
}
