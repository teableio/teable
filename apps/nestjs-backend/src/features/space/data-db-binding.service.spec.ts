/* eslint-disable sonarjs/no-duplicate-string */
import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataDbBindingService } from './data-db-binding.service';
import { encryptDataDbUrl } from './data-db-url-secret';

const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
const initializeEmptyTargetMode = 'initialize-empty';
const internalSchema = 'teable_meta_test';
const schemaVersion = '20260421000000_init_data_db_baseline';
const capabilities = {
  createSchema: true,
  createTable: true,
  createFunction: true,
  createTrigger: true,
  createRole: false,
  grantPrivileges: true,
  inspectActivity: true,
};

describe('DataDbBindingService', () => {
  const txClient = {
    dataDbConnection: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    spaceDataDbBinding: {
      create: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const prismaService = {
    $tx: vi.fn(async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient)),
    dataDbConnection: {
      update: vi.fn(),
    },
    spaceDataDbBinding: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const preflightService = {
    preflight: vi.fn(),
  };
  const baselineService = {
    initialize: vi.fn(),
  };
  const dataDbClientManager = {
    invalidateConnection: vi.fn(),
  };
  const dataDbMigrationService = {
    ensureConnectionMigrated: vi.fn(),
  };
  const byodbBinding = {
    mode: 'byodb',
    state: 'ready',
    dataDbConnection: {
      id: 'dcnxxx',
      provider: 'postgres',
      encryptedUrl: encryptDataDbUrl(dataUrl),
      urlFingerprint: 'dbfp_old',
      displayHost: 'example.com:5432',
      displayDatabase: 'teable_data',
      internalSchema,
      schemaVersion,
      status: 'ready',
      capabilities,
      lastValidatedAt: new Date('2026-05-06T00:00:00.000Z'),
      lastError: null,
      createdBy: 'usrxxx',
    },
  };

  beforeEach(() => {
    txClient.dataDbConnection.upsert.mockReset().mockResolvedValue({ id: 'dcnxxx' });
    txClient.dataDbConnection.update.mockReset();
    txClient.spaceDataDbBinding.create.mockReset();
    txClient.spaceDataDbBinding.upsert.mockReset();
    txClient.spaceDataDbBinding.updateMany.mockReset();
    prismaService.$tx.mockClear();
    preflightService.preflight.mockReset();
    baselineService.initialize.mockReset().mockResolvedValue(schemaVersion);
    dataDbClientManager.invalidateConnection.mockReset();
    dataDbMigrationService.ensureConnectionMigrated.mockReset().mockResolvedValue([]);
    prismaService.dataDbConnection.update.mockReset();
    prismaService.spaceDataDbBinding.findUnique.mockReset().mockResolvedValue(byodbBinding);
    prismaService.spaceDataDbBinding.updateMany.mockReset();
  });

  it('creates an encrypted connection and BYODB binding after successful preflight', async () => {
    preflightService.preflight.mockResolvedValue({
      ok: true,
      provider: 'postgres',
      classification: 'empty',
      capabilities,
      errors: [],
    });
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never
    );

    await service.createBindingForNewSpace('spcxxx', 'usrxxx', {
      mode: 'byodb',
      url: dataUrl,
      targetMode: initializeEmptyTargetMode,
      internalSchema,
    });

    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: dataUrl,
      targetMode: initializeEmptyTargetMode,
      internalSchema,
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, internalSchema);
    expect(txClient.dataDbConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ urlFingerprint: expect.stringMatching(/^dbfp_/) }),
        create: expect.objectContaining({
          encryptedUrl: expect.not.stringContaining('secret'),
          internalSchema,
          schemaVersion,
          status: 'ready',
        }),
        update: expect.objectContaining({
          schemaVersion,
        }),
      })
    );
    expect(txClient.spaceDataDbBinding.create).toHaveBeenCalledWith({
      data: {
        spaceId: 'spcxxx',
        dataDbConnectionId: 'dcnxxx',
        mode: 'byodb',
        state: 'ready',
        createdBy: 'usrxxx',
      },
    });
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnxxx');
  });

  it('generates an internal schema for new BYODB spaces when one is not provided', async () => {
    preflightService.preflight.mockResolvedValue({
      ok: true,
      provider: 'postgres',
      classification: 'empty',
      capabilities,
      errors: [],
    });
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never
    );

    await service.createBindingForNewSpace('spcxxx', 'usrxxx', {
      mode: 'byodb',
      url: dataUrl,
      targetMode: initializeEmptyTargetMode,
    });

    const generatedInternalSchema = expect.stringMatching(/^teable_[a-f0-9]{16}$/);
    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: dataUrl,
      targetMode: initializeEmptyTargetMode,
      internalSchema: generatedInternalSchema,
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, generatedInternalSchema);
    expect(txClient.dataDbConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ internalSchema: generatedInternalSchema }),
      })
    );
  });

  it('reuses the same data DB connection for multiple spaces with the same URL', async () => {
    preflightService.preflight.mockResolvedValue({
      ok: true,
      provider: 'postgres',
      classification: 'teable-managed-compatible',
      capabilities,
      errors: [],
    });
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never
    );

    const dataDb = {
      mode: 'byodb' as const,
      url: dataUrl,
      targetMode: initializeEmptyTargetMode,
      internalSchema,
    };
    await service.createBindingForNewSpace('spcxxx1', 'usrxxx', dataDb);
    await service.createBindingForNewSpace('spcxxx2', 'usrxxx', dataDb);

    expect(txClient.dataDbConnection.upsert).toHaveBeenCalledTimes(2);
    expect(txClient.dataDbConnection.upsert.mock.calls[0]?.[0].where).toEqual(
      txClient.dataDbConnection.upsert.mock.calls[1]?.[0].where
    );
    expect(txClient.spaceDataDbBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        spaceId: 'spcxxx1',
        dataDbConnectionId: 'dcnxxx',
      }),
    });
    expect(txClient.spaceDataDbBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        spaceId: 'spcxxx2',
        dataDbConnectionId: 'dcnxxx',
      }),
    });
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledTimes(2);
  });

  it('rejects BYODB space creation when preflight fails', async () => {
    preflightService.preflight.mockResolvedValue({
      ok: false,
      provider: 'postgres',
      classification: 'non-empty-unknown',
      capabilities,
      errors: [{ code: 'NON_EMPTY_UNKNOWN_DATABASE', message: 'non-empty' }],
    });
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never
    );

    await expect(
      service.prepareBindingForNewSpace({
        mode: 'byodb',
        url: dataUrl,
        targetMode: initializeEmptyTargetMode,
        internalSchema,
      })
    ).rejects.toMatchObject({ code: HttpErrorCode.CONFLICT });
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });

  it('retests an existing BYODB binding without exposing encrypted URL material', async () => {
    preflightService.preflight.mockResolvedValue({
      ok: true,
      provider: 'postgres',
      classification: 'teable-managed-compatible',
      capabilities,
      errors: [],
    });
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never,
      dataDbMigrationService as never
    );

    await service.retestBinding('spcxxx');

    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: dataUrl,
      targetMode: initializeEmptyTargetMode,
      internalSchema,
    });
    expect(txClient.dataDbConnection.upsert).not.toHaveBeenCalled();
    expect(txClient.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dcnxxx' },
        data: expect.objectContaining({
          status: 'ready',
          lastError: null,
        }),
      })
    );
  });

  it('retries migration for an existing BYODB binding', async () => {
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never,
      dataDbMigrationService as never
    );

    await service.retryMigrationForSpace('spcxxx');

    expect(dataDbMigrationService.ensureConnectionMigrated).toHaveBeenCalledWith({
      connectionId: 'dcnxxx',
      internalSchema,
      url: dataUrl,
    });
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnxxx');
  });

  it('updates credentials for the same BYODB database identity', async () => {
    const updatedUrl = 'postgresql://teable:new-secret@example.com:5432/teable_data';
    preflightService.preflight.mockResolvedValue({
      ok: true,
      provider: 'postgres',
      classification: 'teable-managed-compatible',
      capabilities,
      errors: [],
    });
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never,
      dataDbMigrationService as never
    );

    await service.updateBindingForSpace('spcxxx', 'usrxxx', {
      url: updatedUrl,
      targetMode: initializeEmptyTargetMode,
    });

    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: updatedUrl,
      targetMode: initializeEmptyTargetMode,
      internalSchema,
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(updatedUrl, internalSchema);
    expect(prismaService.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dcnxxx' },
        data: expect.objectContaining({
          encryptedUrl: expect.not.stringContaining('new-secret'),
          schemaVersion,
          status: 'ready',
        }),
      })
    );
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnxxx');
  });

  it('adopts a copied database for an existing default space', async () => {
    prismaService.spaceDataDbBinding.findUnique.mockResolvedValue(null);
    preflightService.preflight.mockResolvedValue({
      ok: true,
      provider: 'postgres',
      classification: 'empty',
      capabilities,
      errors: [],
    });
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never,
      dataDbMigrationService as never
    );

    await service.updateBindingForSpace('spcxxx', 'usrxxx', {
      url: dataUrl,
      targetMode: 'adopt-existing',
      internalSchema,
    });

    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: dataUrl,
      targetMode: 'adopt-existing',
      internalSchema,
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, internalSchema);
    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith({
      where: { spaceId: 'spcxxx' },
      create: {
        spaceId: 'spcxxx',
        dataDbConnectionId: 'dcnxxx',
        mode: 'byodb',
        state: 'ready',
        createdBy: 'usrxxx',
      },
      update: {
        dataDbConnectionId: 'dcnxxx',
        mode: 'byodb',
        state: 'ready',
      },
    });
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnxxx');
  });

  it('does not create a BYODB binding for an existing default space without adopt-existing mode', async () => {
    prismaService.spaceDataDbBinding.findUnique.mockResolvedValue(null);
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never,
      dataDbMigrationService as never
    );

    await expect(
      service.updateBindingForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: initializeEmptyTargetMode,
        internalSchema,
      })
    ).rejects.toMatchObject({ code: HttpErrorCode.NOT_FOUND });
    expect(preflightService.preflight).not.toHaveBeenCalled();
    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
  });

  it('rejects credential updates that would move the space to a different data DB', async () => {
    const service = new DataDbBindingService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never,
      dataDbMigrationService as never
    );

    await expect(
      service.updateBindingForSpace('spcxxx', 'usrxxx', {
        url: 'postgresql://teable:secret@other.example.com:5432/teable_data',
        targetMode: initializeEmptyTargetMode,
        internalSchema,
      })
    ).rejects.toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR });
    expect(baselineService.initialize).not.toHaveBeenCalled();
  });
});
