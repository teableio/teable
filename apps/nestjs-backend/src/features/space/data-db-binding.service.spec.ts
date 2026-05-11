import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataDbBindingService } from './data-db-binding.service';

const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
const initializeEmptyTargetMode = 'initialize-empty';
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
    },
    spaceDataDbBinding: {
      create: vi.fn(),
    },
  };
  const prismaService = {
    $tx: vi.fn(async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient)),
  };
  const preflightService = {
    preflight: vi.fn(),
  };
  const baselineService = {
    initialize: vi.fn(),
  };

  beforeEach(() => {
    txClient.dataDbConnection.upsert.mockReset().mockResolvedValue({ id: 'dcnxxx' });
    txClient.spaceDataDbBinding.create.mockReset();
    prismaService.$tx.mockClear();
    preflightService.preflight.mockReset();
    baselineService.initialize.mockReset();
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
      baselineService as never
    );

    await service.createBindingForNewSpace('spcxxx', 'usrxxx', {
      mode: 'byodb',
      url: dataUrl,
      targetMode: initializeEmptyTargetMode,
    });

    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: dataUrl,
      targetMode: initializeEmptyTargetMode,
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl);
    expect(txClient.dataDbConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ urlFingerprint: expect.stringMatching(/^dbfp_/) }),
        create: expect.objectContaining({
          encryptedUrl: expect.not.stringContaining('secret'),
          status: 'ready',
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
      baselineService as never
    );

    await expect(
      service.prepareBindingForNewSpace({
        mode: 'byodb',
        url: dataUrl,
        targetMode: initializeEmptyTargetMode,
      })
    ).rejects.toMatchObject({ code: HttpErrorCode.CONFLICT });
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });
});
