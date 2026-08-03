import { describe, expect, it } from 'vitest';
import { createSpaceRoSchema } from './create';
import {
  CANCEL_SPACE_DATA_DB_MIGRATION,
  ROLLBACK_SPACE_DATA_DB_MIGRATION,
  dataDbConnectionSummaryVoSchema,
  dataDbMigrationJobStatusVoSchema,
  dataDbPreflightRoSchema,
  dataDbPreflightVoSchema,
} from './data-db';

const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
const displayHost = 'example.com:5432';
const internalSchema = 'teable_meta_test';
const migrateSpaceTargetMode = 'migrate-space';
const schemaVersion = '20260421000000_init_data_db_baseline';
const validatedAt = '2026-05-06T00:00:00.000Z';

describe('space data DB schemas', () => {
  it('accepts a BYODB preflight request', () => {
    const result = dataDbPreflightRoSchema.safeParse({
      url: dataUrl,
      internalSchema,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.targetMode).toBe('initialize-empty');
  });

  it('accepts explicit large-migration confirmation for migrate-space requests', () => {
    const result = dataDbPreflightRoSchema.safeParse({
      url: dataUrl,
      spaceId: 'spcxxx',
      targetMode: migrateSpaceTargetMode,
      internalSchema,
      confirmLargeMigration: true,
      switchOnCompletion: true,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.spaceId).toBe('spcxxx');
    expect(result.success && result.data.confirmLargeMigration).toBe(true);
    expect(result.success && result.data.switchOnCompletion).toBe(true);
  });

  it('accepts the create-space BYODB extension', () => {
    const result = createSpaceRoSchema.safeParse({
      name: 'BYODB Space',
      dataDb: {
        mode: 'byodb',
        url: dataUrl,
        targetMode: 'initialize-empty',
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown create-space data DB mode', () => {
    const result = createSpaceRoSchema.safeParse({
      name: 'BYODB Space',
      dataDb: {
        mode: 'external',
      },
    });

    expect(result.success).toBe(false);
  });

  it('keeps preflight output structured and secret-free', () => {
    const result = dataDbPreflightVoSchema.parse({
      ok: true,
      provider: 'postgres',
      maskedUrl: 'postgresql://teable:***@example.com:5432/teable_data',
      urlFingerprint: 'dbfp_123',
      displayHost,
      displayDatabase: 'teable_data',
      internalSchema,
      serverVersion: '14.12',
      classification: 'empty',
      availableDatabases: ['postgres', 'teable_data'],
      requiresDatabaseSelection: false,
      capabilities: {
        createSchema: true,
        createTable: true,
        createFunction: true,
        createTrigger: true,
        createRole: false,
        grantPrivileges: true,
        inspectActivity: true,
      },
      errors: [],
    });

    expect(result.maskedUrl).not.toContain('secret');
    expect(result.availableDatabases).toEqual(['postgres', 'teable_data']);
    expect(result.requiresDatabaseSelection).toBe(false);
  });

  it('accepts a default space data DB summary', () => {
    expect(
      dataDbConnectionSummaryVoSchema.parse({
        mode: 'default',
        state: 'ready',
      })
    ).toEqual({
      mode: 'default',
      state: 'ready',
    });
  });

  it('accepts a BYODB summary with schema version metadata', () => {
    expect(
      dataDbConnectionSummaryVoSchema.parse({
        mode: 'byodb',
        state: 'ready',
        provider: 'postgres',
        displayHost,
        displayDatabase: 'teable_data',
        internalSchema,
        schemaVersion,
        lastValidatedAt: validatedAt,
      })
    ).toMatchObject({
      mode: 'byodb',
      schemaVersion,
    });
  });

  it('accepts a migrating summary with a discoverable migration job id', () => {
    expect(
      dataDbConnectionSummaryVoSchema.parse({
        mode: 'byodb',
        state: 'migrating',
        provider: 'postgres',
        internalSchema,
        migration: {
          jobId: 'sdmjxxx',
          state: 'copying',
          targetInternalSchema: internalSchema,
          switchOnCompletion: false,
          lastError: null,
        },
      })
    ).toMatchObject({
      state: 'migrating',
      migration: {
        jobId: 'sdmjxxx',
        state: 'copying',
      },
    });
  });

  it('accepts a migration job detail without connection secrets', () => {
    const status = dataDbMigrationJobStatusVoSchema.parse({
      jobId: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetMode: migrateSpaceTargetMode,
      switchOnCompletion: false,
      state: 'copying',
      targetInternalSchema: internalSchema,
      targetConnection: {
        provider: 'postgres',
        displayHost,
        displayDatabase: 'teable_data',
        internalSchema,
        schemaVersion,
        lastValidatedAt: validatedAt,
      },
      inventory: {
        baseIds: ['bsexxx'],
      },
      copyStats: {
        phase: 'copying_shared_rows',
      },
      validationStats: null,
      lastError: null,
      startedAt: validatedAt,
      completedAt: null,
      createdTime: validatedAt,
      lastModifiedTime: '2026-05-06T00:01:00.000Z',
    });

    expect(JSON.stringify(status)).not.toContain('secret');
    expect(status.targetConnection?.displayHost).toBe(displayHost);
    expect(status.switchOnCompletion).toBe(false);
  });

  it('accepts an asynchronous migration job waiting for a worker', () => {
    expect(
      dataDbMigrationJobStatusVoSchema.parse({
        jobId: 'sdmjwaiting',
        spaceId: 'spcxxx',
        targetMode: migrateSpaceTargetMode,
        switchOnCompletion: false,
        state: 'waiting_worker',
        targetInternalSchema: internalSchema,
        targetConnection: null,
        inventory: {
          baseIds: ['bsexxx'],
        },
        copyStats: null,
        validationStats: null,
        lastError: null,
        startedAt: null,
        completedAt: null,
        createdTime: validatedAt,
        lastModifiedTime: validatedAt,
      })
    ).toMatchObject({
      state: 'waiting_worker',
      startedAt: null,
      completedAt: null,
    });
  });

  it('exposes a cancel route for pre-copy migration jobs', () => {
    expect(CANCEL_SPACE_DATA_DB_MIGRATION).toBe(
      '/space/{spaceId}/data-db/migration/{jobId}/cancel'
    );
    expect(
      dataDbMigrationJobStatusVoSchema.parse({
        jobId: 'sdmjxxx',
        spaceId: 'spcxxx',
        targetMode: migrateSpaceTargetMode,
        state: 'canceled',
        targetInternalSchema: internalSchema,
        targetConnection: null,
        inventory: { baseIds: ['bsexxx'] },
        copyStats: { phase: 'canceled_before_copy' },
        validationStats: null,
        lastError: 'Space data database migration canceled',
        startedAt: validatedAt,
        completedAt: validatedAt,
        createdTime: validatedAt,
        lastModifiedTime: validatedAt,
      })
    ).toMatchObject({
      state: 'canceled',
      copyStats: { phase: 'canceled_before_copy' },
    });
  });

  it('exposes a rollback route for safe post-switch rollback jobs', () => {
    expect(ROLLBACK_SPACE_DATA_DB_MIGRATION).toBe(
      '/space/{spaceId}/data-db/migration/{jobId}/rollback'
    );
    expect(
      dataDbMigrationJobStatusVoSchema.parse({
        jobId: 'sdmjxxx',
        spaceId: 'spcxxx',
        targetMode: migrateSpaceTargetMode,
        state: 'rolled_back',
        targetInternalSchema: internalSchema,
        targetConnection: null,
        inventory: { baseIds: ['bsexxx'] },
        copyStats: { phase: 'rollback_completed' },
        validationStats: { rollback: { eligible: true } },
        lastError: null,
        startedAt: validatedAt,
        completedAt: validatedAt,
        createdTime: validatedAt,
        lastModifiedTime: validatedAt,
      })
    ).toMatchObject({
      state: 'rolled_back',
      validationStats: { rollback: { eligible: true } },
    });
  });
});
