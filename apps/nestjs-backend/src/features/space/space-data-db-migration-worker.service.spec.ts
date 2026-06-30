import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceDataDbMigrationWorkerService } from './space-data-db-migration-worker.service';

describe('SpaceDataDbMigrationWorkerService', () => {
  const workerId = 'worker-test';
  const migrationService = {
    recoverStaleActiveMigrationJobs: vi.fn(),
    claimNextPendingMigrationJob: vi.fn(),
    runMigrationJob: vi.fn(),
  };

  beforeEach(() => {
    vi.stubEnv('BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ID', workerId);
    migrationService.recoverStaleActiveMigrationJobs.mockReset().mockResolvedValue([]);
    migrationService.claimNextPendingMigrationJob.mockReset().mockResolvedValue(null);
    migrationService.runMigrationJob.mockReset().mockResolvedValue({ state: 'succeeded' });
  });

  it('returns null when there is no pending job', async () => {
    const service = new SpaceDataDbMigrationWorkerService(migrationService as never);

    await expect(service.runOnce()).resolves.toBeNull();

    expect(migrationService.recoverStaleActiveMigrationJobs).toHaveBeenCalledWith(workerId);
    expect(migrationService.claimNextPendingMigrationJob).toHaveBeenCalledWith(workerId);
    expect(migrationService.runMigrationJob).not.toHaveBeenCalled();
  });

  it('runs a claimed migration job', async () => {
    migrationService.claimNextPendingMigrationJob.mockResolvedValue({ jobId: 'sdmjxxx' });
    const service = new SpaceDataDbMigrationWorkerService(migrationService as never);

    await expect(service.runOnce()).resolves.toEqual({
      jobId: 'sdmjxxx',
      status: 'succeeded',
    });

    expect(migrationService.runMigrationJob).toHaveBeenCalledWith('sdmjxxx');
  });

  it('logs and reports a failed claimed migration job without throwing', async () => {
    migrationService.claimNextPendingMigrationJob.mockResolvedValue({ jobId: 'sdmjxxx' });
    migrationService.runMigrationJob.mockRejectedValue(new Error('copy failed'));
    const service = new SpaceDataDbMigrationWorkerService(migrationService as never);

    await expect(service.runOnce()).resolves.toEqual({
      jobId: 'sdmjxxx',
      status: 'failed',
      error: 'copy failed',
    });
  });
});
