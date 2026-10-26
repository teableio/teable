import { FieldKeyType, HttpErrorCode } from '@teable/core';
import type { IUpsertRecordsRo } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';

import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { RecordOpenApiController } from './record-open-api.controller';

type ClsValues = Record<string, unknown>;

const buildController = (options?: {
  cls?: ClsValues;
  permissionService?: { validPermissions: ReturnType<typeof vi.fn> } | null;
  shareViewScopeService?: { assertUpsertRecords: ReturnType<typeof vi.fn> };
  v2Service?: { upsertRecords: ReturnType<typeof vi.fn> };
}) => {
  const clsValues: ClsValues = { useV2: true, ...options?.cls };
  const cls = { get: (key: string) => clsValues[key] } as unknown as ClsService<IClsStore>;
  const permissionService =
    options && 'permissionService' in options
      ? options.permissionService
      : { validPermissions: vi.fn().mockResolvedValue([]) };
  const shareViewScopeService = options?.shareViewScopeService ?? {
    assertUpsertRecords: vi.fn().mockResolvedValue(undefined),
  };
  const v2Service = options?.v2Service ?? {
    upsertRecords: vi.fn().mockResolvedValue({ results: [], summary: {} }),
  };

  const controller = new RecordOpenApiController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    cls,
    v2Service as never,
    shareViewScopeService as never,
    {} as never,
    permissionService as never
  );

  return {
    controller,
    permissionService: permissionService as { validPermissions: ReturnType<typeof vi.fn> },
    shareViewScopeService,
    v2Service,
  };
};

const ro: IUpsertRecordsRo = {
  matchField: `fld${'k'.repeat(16)}`,
  onConflict: 'ignore',
  fieldKeyType: FieldKeyType.Id,
  records: [{ fields: { [`fld${'t'.repeat(16)}`]: 'value' } }],
};

const expectRejection = async (call: () => Promise<unknown>): Promise<CustomHttpException> => {
  try {
    await call();
  } catch (error) {
    return error as CustomHttpException;
  }
  throw new Error('expected the upsert call to reject');
};

describe('RecordOpenApiController.upsertRecords access gates', () => {
  it('requires create and update for ignore mode before executing', async () => {
    const { controller, permissionService, v2Service } = buildController();

    await controller.upsertRecords('tbl-test', ro);

    expect(permissionService.validPermissions).toHaveBeenCalledWith(
      'tbl-test',
      ['record|create', 'record|update'],
      undefined
    );
    expect(v2Service.upsertRecords).toHaveBeenCalled();
  });

  it('requires create and update for update mode', async () => {
    const { controller, permissionService } = buildController();

    await controller.upsertRecords('tbl-test', { ...ro, onConflict: 'update' });

    expect(permissionService.validPermissions).toHaveBeenCalledWith(
      'tbl-test',
      ['record|create', 'record|update'],
      undefined
    );
  });

  it('requires only create for error mode', async () => {
    const { controller, permissionService } = buildController();

    await controller.upsertRecords('tbl-test', { ...ro, onConflict: 'error' });

    expect(permissionService.validPermissions).toHaveBeenCalledWith(
      'tbl-test',
      ['record|create'],
      undefined
    );
  });

  it('fails closed when the permission service is missing', async () => {
    const { controller, v2Service } = buildController({ permissionService: null });

    const error = await expectRejection(() => controller.upsertRecords('tbl-test', ro));
    expect(error.getStatus()).toBe(403);
    expect(v2Service.upsertRecords).not.toHaveBeenCalled();
  });

  it('surfaces a permission rejection and never executes the command', async () => {
    const { controller, v2Service } = buildController({
      permissionService: {
        validPermissions: vi
          .fn()
          .mockRejectedValue(
            new CustomHttpException('not allowed', HttpErrorCode.RESTRICTED_RESOURCE)
          ),
      },
    });

    const error = await expectRejection(() => controller.upsertRecords('tbl-test', ro));

    expect(error.getStatus()).toBe(403);
    expect(v2Service.upsertRecords).not.toHaveBeenCalled();
  });

  it('rejects when the space is not on v2', async () => {
    const { controller, v2Service } = buildController({ cls: { useV2: false } });

    const error = await expectRejection(() => controller.upsertRecords('tbl-test', ro));

    expect(error.getStatus()).toBe(400);
    expect(error.data).toMatchObject({ domainCode: 'record.upsert.v2_required' });
    expect(error.code).toBe(HttpErrorCode.VALIDATION_ERROR);
    expect(v2Service.upsertRecords).not.toHaveBeenCalled();
  });

  it.each(['error', 'ignore', 'update'] as const)(
    'fails closed for share-view upsert in %s mode',
    async (onConflict) => {
      const { controller, permissionService, v2Service } = buildController({
        cls: { shareViewId: 'shr-test' },
      });

      const error = await expectRejection(() =>
        controller.upsertRecords('tbl-test', { ...ro, onConflict })
      );

      // The core matcher has no share-view row filter or field masks, so the route
      // must not run at all: no recordId/record can leak and no write can happen.
      expect(error.getStatus()).toBe(403);
      expect(permissionService.validPermissions).not.toHaveBeenCalled();
      expect(v2Service.upsertRecords).not.toHaveBeenCalled();
    }
  );
});
