import { HttpErrorCode } from '@teable/core';
import { domainError, type DomainError } from '@teable/v2-core';
import { v2TableOpsTokens, type TableSearchVectorStatus } from '@teable/v2-table-query-ops';
import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { TableIndexService } from './table-index.service';

const tableId = 'tblSearchVectorTest';

const createService = (input: {
  registered: boolean;
  runtimeEnabled?: boolean;
  result?: Result<TableSearchVectorStatus, DomainError>;
}) => {
  const reader = {
    read: vi.fn().mockResolvedValue(
      input.result ??
        ok({
          tableId,
          state: 'ready',
          configured: true,
          languageConfig: 'simple',
          coveredFieldCount: 3,
        } satisfies TableSearchVectorStatus)
    ),
  };
  const container = {
    isRegistered: vi.fn().mockReturnValue(input.registered),
    resolve: vi.fn().mockReturnValue(reader),
  };
  const v2ContainerService = {
    getContainerForTable: vi.fn().mockResolvedValue(container),
    isTableQuerySearchVectorRuntimeEnabled: vi.fn().mockReturnValue(input.runtimeEnabled ?? true),
  };
  const v2ExecutionContextFactory = {
    createContext: vi.fn().mockResolvedValue({ requestId: 'test' }),
  };
  const prismaService = {
    txClient: () => ({
      tableMeta: { findUnique: vi.fn().mockResolvedValue({ baseId: 'bseV2' }) },
      base: {
        findUnique: vi.fn().mockResolvedValue({ spaceId: 'spcV2', v2Enabled: true }),
      },
    }),
  };
  const canaryService = {
    shouldUseV2ForBaseWithReason: vi.fn().mockResolvedValue({ useV2: true, reason: 'new_base' }),
  };
  const service = new TableIndexService(
    {} as never,
    prismaService as never,
    {} as never,
    {} as never,
    {} as never,
    canaryService as never,
    v2ContainerService as never,
    v2ExecutionContextFactory as never
  );

  return { service, reader, container, v2ContainerService, v2ExecutionContextFactory };
};

describe('TableIndexService search vector status', () => {
  it('returns disabled when the host module does not mount v2 services', async () => {
    const service = new TableIndexService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        shouldUseV2ForBaseWithReason: vi
          .fn()
          .mockResolvedValue({ useV2: true, reason: 'new_base' }),
      } as never,
      undefined as never,
      undefined as never
    );

    await expect(service.getSearchVectorStatus(tableId)).resolves.toEqual({
      tableId,
      state: 'disabled',
      configured: false,
      active: false,
      coveredFieldCount: 0,
    });
  });

  it('returns disabled when Table Query Ops is not registered', async () => {
    const { service, container, reader, v2ExecutionContextFactory } = createService({
      registered: false,
    });

    await expect(service.getSearchVectorStatus(tableId)).resolves.toEqual({
      tableId,
      state: 'disabled',
      configured: false,
      active: false,
      coveredFieldCount: 0,
    });
    expect(container.isRegistered).toHaveBeenCalledWith(v2TableOpsTokens.searchVectorStatusReader);
    expect(v2ExecutionContextFactory.createContext).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('returns the read-only adapter status when registered', async () => {
    const { service, reader } = createService({ registered: true });

    await expect(service.getSearchVectorStatus(tableId)).resolves.toMatchObject({
      state: 'ready',
      configured: true,
      active: true,
      coveredFieldCount: 3,
    });
    expect(reader.read).toHaveBeenCalledWith({ requestId: 'test' }, tableId);
  });

  it('does not report a ready config as active while the runtime gate is off', async () => {
    const { service } = createService({ registered: true, runtimeEnabled: false });

    await expect(service.getSearchVectorStatus(tableId)).resolves.toMatchObject({
      state: 'ready',
      configured: true,
      active: false,
    });
  });

  it('keeps a ready config inactive when the host module does not mount CanaryService', async () => {
    const { service } = createService({ registered: true });
    Object.assign(service, { canaryService: undefined });

    await expect(service.getSearchVectorStatus(tableId)).resolves.toMatchObject({
      state: 'ready',
      configured: true,
      active: false,
    });
  });

  it('does not report a ready config as active when record reads stay on v1', async () => {
    const { service } = createService({ registered: true });
    const tableMetaFindUnique = vi.fn().mockResolvedValue({ baseId: 'bseLegacy' });
    const baseFindUnique = vi.fn().mockResolvedValue({ spaceId: 'spcLegacy', v2Enabled: false });
    const shouldUseV2ForBaseWithReason = vi
      .fn()
      .mockResolvedValue({ useV2: false, reason: 'feature_not_enabled' });
    Object.assign(service, {
      prismaService: {
        txClient: () => ({
          tableMeta: { findUnique: tableMetaFindUnique },
          base: { findUnique: baseFindUnique },
        }),
      },
      canaryService: { shouldUseV2ForBaseWithReason },
    });

    await expect(service.getSearchVectorStatus(tableId)).resolves.toMatchObject({
      state: 'ready',
      configured: true,
      active: false,
    });
    expect(shouldUseV2ForBaseWithReason).toHaveBeenCalledWith(
      { spaceId: 'spcLegacy', v2Enabled: false },
      'getRecords'
    );
  });
  it('maps adapter errors to an internal HTTP error', async () => {
    const { service } = createService({
      registered: true,
      result: err(domainError.infrastructure({ message: 'read failed' })),
    });

    await expect(service.getSearchVectorStatus(tableId)).rejects.toMatchObject({
      code: HttpErrorCode.INTERNAL_SERVER_ERROR,
    });
  });
});
