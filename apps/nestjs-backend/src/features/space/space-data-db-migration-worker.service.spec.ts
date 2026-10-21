import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpaceDataDbMigrationWorkerService } from './space-data-db-migration-worker.service';

describe('SpaceDataDbMigrationWorkerService', () => {
  const workerId = 'worker-test';
  const migrationService = {
    recoverStaleActiveMigrationJobs: vi.fn(),
    claimNextPendingMigrationJob: vi.fn(),
    runMigrationJob: vi.fn(),
  };

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ID', workerId);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VITEST', 'true');
    migrationService.recoverStaleActiveMigrationJobs.mockReset().mockResolvedValue([]);
    migrationService.claimNextPendingMigrationJob.mockReset().mockResolvedValue(null);
    migrationService.runMigrationJob.mockReset().mockResolvedValue({ state: 'succeeded' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('does not auto-start the poll loop in test runtime', () => {
    const service = new SpaceDataDbMigrationWorkerService(migrationService as never);
    const runForever = vi.spyOn(service, 'runForever').mockResolvedValue(undefined);

    service.onApplicationBootstrap();

    expect(runForever).not.toHaveBeenCalled();
  });

  it('starts the poll loop when explicitly enabled', async () => {
    vi.stubEnv('BYODB_SPACE_DATA_DB_MIGRATION_WORKER_ENABLED', 'true');
    const service = new SpaceDataDbMigrationWorkerService(migrationService as never);
    const runForever = vi.spyOn(service, 'runForever').mockImplementation(async () => {
      service.stop();
    });

    service.onApplicationBootstrap();
    await service.waitForStop();

    expect(runForever).toHaveBeenCalledOnce();
  });
});
