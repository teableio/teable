import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import type { PrismaService } from '@teable/db-main-prisma';
import {
  ActorId,
  BaseId,
  domainError,
  err,
  ok,
  v2CoreTokens,
  type IQueryBus,
  type RecordQueryPluginRunner,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { IVcsHeadInfo, IVcsIncrementalChanges, IVcsPushResult } from '@teable/v2-vcs';
import { v2VcsServerTokens } from '@teable/v2-vcs/server';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../../types/cls';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { RESOURCE_META } from '../../auth/decorators/resource_meta.decorator';
import { IS_TOKEN_ACCESS } from '../../auth/decorators/token.decorator';
import type { PermissionService } from '../../auth/permission.service';
import type { V2ContainerService } from '../v2-container.service';
import type { V2ExecutionContextFactory } from '../v2-execution-context.factory';
import { BaseVcsController } from './base-vcs.controller';
import { NestVcsAccessPolicy } from './nest-vcs-access-policy.service';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_READABLE = `fld${'r'.repeat(16)}`;
const FIELD_HIDDEN = `fld${'h'.repeat(16)}`;

const makeExecutionCtx = () => ({ actorId: ActorId.create('usr_test')._unsafeUnwrap() });

const makeController = (services: Partial<Record<symbol, unknown>>) => {
  const container = {
    resolve: (token: symbol) => services[token],
  } as unknown as DependencyContainer;
  const v2ContainerService = {
    getContainerForBase: vi.fn().mockResolvedValue(container),
  } as unknown as V2ContainerService;
  const v2ContextFactory = {
    createContext: vi.fn().mockResolvedValue(makeExecutionCtx()),
  } as unknown as V2ExecutionContextFactory;
  return new BaseVcsController(v2ContainerService, v2ContextFactory);
};

describe('BaseVcsController routes & NestVcsAccessPolicy', () => {
  it('enforces @Permissions/@AnyPermissions, @TokenAccess, and @ResourceMeta(baseId, params) on all endpoints', () => {
    const prototype = BaseVcsController.prototype;
    for (const methodName of ['getHead', 'clone', 'cloneRecords', 'changes'] as const) {
      const handler = prototype[methodName];
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['base|read']);
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(IS_TOKEN_ACCESS, handler)).toBe(true);
      expect(Reflect.getMetadata(RESOURCE_META, handler)).toEqual({
        type: 'baseId',
        position: 'params',
      });
    }

    const enableHandler = prototype.enable;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, enableHandler)).toEqual(['base|update']);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, enableHandler)).toBeUndefined();
    expect(Reflect.getMetadata(IS_TOKEN_ACCESS, enableHandler)).toBe(true);
    expect(Reflect.getMetadata(RESOURCE_META, enableHandler)).toEqual({
      type: 'baseId',
      position: 'params',
    });

    const pushHandler = prototype.push;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, pushHandler)).toEqual(['base|update']);
    const pushAnyPerms = Reflect.getMetadata(ANY_PERMISSIONS_KEY, pushHandler) as string[][];
    expect(pushAnyPerms).toEqual(
      expect.arrayContaining([['table|create'], ['field|update'], ['record|update']])
    );
    expect(pushAnyPerms).toHaveLength(12);
    expect(Reflect.getMetadata(IS_TOKEN_ACCESS, pushHandler)).toBe(true);
    expect(Reflect.getMetadata(RESOURCE_META, pushHandler)).toEqual({
      type: 'baseId',
      position: 'params',
    });
  });

  // The ledger belongs to the enterprise backend, which the open-source tree does not carry.
  const enterpriseBackendPath = path.resolve(
    __dirname,
    '../../../../../../../enterprise/backend-ee'
  );
  it.skipIf(!existsSync(enterpriseBackendPath))(
    'registers POST enable and push routes in enterprise audit-route-ledger',
    () => {
      const ledgerPath = path.join(enterpriseBackendPath, 'test/admin/audit-route-ledger.ts');
      expect(existsSync(ledgerPath)).toBe(true);
      const ledgerSource = readFileSync(ledgerPath, 'utf8');
      expect(ledgerSource).toContain("'POST /api/v2/bases/:baseId/vcs/enable'");
      expect(ledgerSource).toContain("'POST /api/v2/bases/:baseId/vcs/push'");
      expect(ledgerSource).toContain('audited: via V2AuditLogService projections');
    }
  );

  it('delegates enable, head, clone, and cursor-required changes while rejecting missing cursors', async () => {
    const headInfo: IVcsHeadInfo = {
      baseId: BASE_ID,
      baseName: 'Demo',
      headRevision: 4,
      remoteMode: 'v2-vcs',
    };
    const changesRes: IVcsIncrementalChanges = {
      baseId: BASE_ID,
      baseName: 'Demo',
      fromRevision: 2,
      toRevision: 4,
      nextCursor: 'v2|all|101|101:101:',
      requiresFullSync: false,
      upsertedTables: [],
      deletedTableIds: [],
      recordDeltas: [],
    };
    const cloneOutput = {
      snapshot: {
        formatVersion: 1,
        baseId: BASE_ID,
        baseName: 'Demo',
        revision: 4,
        capturedAt: '2026-11-18T00:00:00Z',
        tables: [],
      },
      remoteMode: 'v2-vcs' as const,
    };

    const enableExec = vi.fn().mockResolvedValue(ok({ enabledAtRevision: 4 }));
    const headExec = vi.fn().mockResolvedValue(ok(headInfo));
    const cloneExec = vi.fn().mockResolvedValue(ok(cloneOutput));
    const cloneRecordsExec = vi.fn().mockResolvedValue(
      ok({
        tableId: TABLE_ID,
        records: [{ id: 'recChunk0000000001', fields: { [FIELD_READABLE]: 'Row 1' } }],
        nextCursor: 'cursor_1',
        hasMore: true,
      })
    );
    const changesExec = vi.fn().mockResolvedValue(ok(changesRes));

    const controller = makeController({
      [v2VcsServerTokens.enableBaseVcsService]: { execute: enableExec },
      [v2VcsServerTokens.getVcsHeadService]: { execute: headExec },
      [v2VcsServerTokens.cloneVcsSnapshotService]: { execute: cloneExec },
      [v2VcsServerTokens.listVcsTableRecordsChunkService]: { execute: cloneRecordsExec },
      [v2VcsServerTokens.listVcsChangesService]: { execute: changesExec },
    });

    await expect(controller.enable(BASE_ID)).resolves.toEqual({
      baseId: BASE_ID,
      enabled: true,
      headRevision: 4,
      enabledAtRevision: 4,
    });
    expect(enableExec).toHaveBeenCalledWith(expect.anything(), { baseId: BASE_ID });

    await expect(controller.getHead(BASE_ID)).resolves.toEqual(headInfo);
    await expect(
      controller.clone(BASE_ID, 'tbl1, tbl2', ['tbl2', 'tbl3'], 'false')
    ).resolves.toEqual(cloneOutput);
    expect(cloneExec).toHaveBeenCalledWith(expect.anything(), {
      baseId: BASE_ID,
      tableIds: ['tbl1', 'tbl2', 'tbl3'],
      includeRecords: false,
    });

    await expect(controller.cloneRecords(BASE_ID, TABLE_ID, 'cursor_0', '50')).resolves.toEqual({
      tableId: TABLE_ID,
      records: [{ id: 'recChunk0000000001', fields: { [FIELD_READABLE]: 'Row 1' } }],
      nextCursor: 'cursor_1',
      hasMore: true,
    });
    expect(cloneRecordsExec).toHaveBeenCalledWith(expect.anything(), {
      baseId: BASE_ID,
      tableId: TABLE_ID,
      cursor: 'cursor_0',
      limit: 50,
    });
    expect(() => controller.cloneRecords(BASE_ID, undefined)).toThrow(BadRequestException);
    expect(() => controller.cloneRecords(BASE_ID, TABLE_ID, undefined, '0')).toThrow(
      BadRequestException
    );
    expect(() => controller.clone(BASE_ID, undefined, undefined, 'not-bool')).toThrow(
      BadRequestException
    );

    await expect(controller.changes(BASE_ID, 'v2|all|100|100:100:', '2', 'tbl1')).resolves.toEqual(
      changesRes
    );
    expect(changesExec).toHaveBeenCalledWith(expect.anything(), {
      baseId: BASE_ID,
      cursor: 'v2|all|100|100:100:',
      sinceRevision: 2,
      tableIds: ['tbl1'],
    });

    await expect(controller.changes(BASE_ID, undefined)).rejects.toThrow(BadRequestException);
    await expect(controller.changes(BASE_ID, '   ')).rejects.toThrow(BadRequestException);
    await expect(controller.changes(BASE_ID, 'v2|all|100|100:100:', '-1')).rejects.toThrow(
      BadRequestException
    );
    await expect(controller.changes(BASE_ID, 'v2|all|100|100:100:', 'abc')).rejects.toThrow(
      BadRequestException
    );
  });

  it('delegates push and maps DomainError 409/403 into HttpException envelopes', async () => {
    const okResult: IVcsPushResult = {
      ok: true,
      dryRun: false,
      baseId: BASE_ID,
      baseRevision: 3,
      newRevision: 4,
      commitId: 'vcsc_abc',
      rebased: false,
      summary: {
        tablesAdded: 0,
        tablesDeleted: 0,
        tablesRenamed: 0,
        fieldsAdded: 0,
        fieldsUpdated: 0,
        fieldsDeleted: 0,
        viewsAdded: 0,
        viewsUpdated: 0,
        viewsDeleted: 0,
        recordsAdded: 1,
        recordsUpdated: 0,
        recordsDeleted: 0,
        cellChanges: 0,
      },
    };
    const okPush = vi.fn().mockResolvedValue(ok(okResult));
    const okController = makeController({
      [v2VcsServerTokens.pushVcsPatchService]: { execute: okPush },
    });
    await expect(okController.push(BASE_ID, { baseRevision: 3 })).resolves.toEqual(okResult);
    expect(okPush).toHaveBeenCalledWith(expect.anything(), { baseId: BASE_ID, baseRevision: 3 });

    const conflictController = makeController({
      [v2VcsServerTokens.pushVcsPatchService]: {
        execute: vi.fn().mockResolvedValue(
          err(
            domainError.conflict({
              code: 'vcs.cas_conflict',
              message: 'Live state changed',
              details: { headRevision: 4, overlappingKeys: [`${TABLE_ID}:record:rec1`] },
            })
          )
        ),
      },
    });
    await expect(conflictController.push(BASE_ID, {})).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: {
        ok: false,
        error: {
          code: 'vcs.cas_conflict',
          message: 'Live state changed',
        },
      },
    });

    const forbiddenController = makeController({
      [v2VcsServerTokens.pushVcsPatchService]: {
        execute: vi
          .fn()
          .mockResolvedValue(
            err(domainError.forbidden({ code: 'vcs.forbidden', message: 'Missing permissions' }))
          ),
      },
    });
    try {
      await forbiddenController.push(BASE_ID, {});
      expect.unreachable('expected HttpException');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });

  it('enforces write RBAC, field masks, row filters, and base ownership in NestVcsAccessPolicy', async () => {
    const prisma = {
      tableMeta: {
        findMany: vi.fn().mockResolvedValue([{ id: TABLE_ID, baseId: BASE_ID }]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      field: { findFirst: vi.fn().mockResolvedValue(null) },
      view: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const permissions = {
      getBaseShareVisibleResourceIds: vi.fn().mockResolvedValue(null),
      getPermissions: vi.fn().mockResolvedValue(['table|read', 'record|read']),
      validPermissions: vi.fn().mockRejectedValue(new ForbiddenException('missing record|update')),
    } as unknown as PermissionService;

    const cls = { get: vi.fn().mockReturnValue(undefined) } as unknown as ClsService<IClsStore>;
    const queryBus = {
      execute: vi.fn().mockResolvedValue(
        ok({
          tables: [
            {
              id: () => ({ toString: () => TABLE_ID }),
              getFields: () => [
                {
                  id: () => ({ toString: () => FIELD_READABLE }),
                  type: () => ({ toString: () => 'singleLineText' }),
                  computed: () => ({ toBoolean: () => false }),
                },
                {
                  id: () => ({ toString: () => FIELD_HIDDEN }),
                  type: () => ({ toString: () => 'singleLineText' }),
                  computed: () => ({ toBoolean: () => false }),
                },
              ],
            },
          ],
        })
      ),
    } as unknown as IQueryBus;

    const runner = {
      prepare: vi.fn().mockResolvedValue(
        ok({
          guard: vi.fn().mockResolvedValue(ok(undefined)),
          getScope: vi.fn().mockReturnValue(
            ok({
              readableFieldIds: [FIELD_READABLE],
              isRowFiltered: false,
            })
          ),
        })
      ),
    } as unknown as RecordQueryPluginRunner;

    const container = {
      resolve: (token: unknown) => (token === v2CoreTokens.queryBus ? queryBus : runner),
      isRegistered: () => true,
    } as unknown as DependencyContainer;

    const policy = new NestVcsAccessPolicy(prisma, permissions, cls).forContainer(container);
    const ctx = makeExecutionCtx();
    const baseIdVo = BaseId.create(BASE_ID)._unsafeUnwrap();

    // Read-only caller gets HTTP 403 domainError when pushing record mutations
    const deniedWrite = await policy.assertCanApplyPatch(ctx, baseIdVo, {
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated: [
        {
          tableId: TABLE_ID,
          fieldsAdded: [],
          fieldsUpdated: [],
          fieldsDeleted: [],
          viewsAdded: [],
          viewsUpdated: [],
          viewsDeleted: [],
          recordsAdded: [],
          recordsUpdated: [
            {
              recordId: `rec${'1'.repeat(16)}`,
              cellChanges: [{ fieldId: FIELD_READABLE, before: 'a', after: 'b' }],
            },
          ],
          recordsDeleted: [],
        },
      ],
    });
    expect(deniedWrite.isErr()).toBe(true);
    expect(deniedWrite._unsafeUnwrapErr().tags).toContain('forbidden');

    // Authorized editor attempting to write an unreadable (masked) field is denied too
    (permissions.validPermissions as ReturnType<typeof vi.fn>).mockResolvedValue([
      'table|read',
      'record|update',
    ]);
    const deniedMaskedField = await policy.assertCanApplyPatch(ctx, baseIdVo, {
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated: [
        {
          tableId: TABLE_ID,
          fieldsAdded: [],
          fieldsUpdated: [],
          fieldsDeleted: [],
          viewsAdded: [],
          viewsUpdated: [],
          viewsDeleted: [],
          recordsAdded: [],
          recordsUpdated: [
            {
              recordId: `rec${'1'.repeat(16)}`,
              cellChanges: [{ fieldId: FIELD_HIDDEN, before: 'a', after: 'b' }],
            },
          ],
          recordsDeleted: [],
        },
      ],
    });
    expect(deniedMaskedField.isErr()).toBe(true);
    expect(deniedMaskedField._unsafeUnwrapErr().code).toBe('vcs.field_write_forbidden');

    // Authorized editor attempting to delete records while a stored field is hidden is denied
    (permissions.validPermissions as ReturnType<typeof vi.fn>).mockResolvedValue([
      'table|read',
      'record|update',
      'record|delete',
    ]);
    const deniedRecordDelete = await policy.assertCanApplyPatch(ctx, baseIdVo, {
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated: [
        {
          tableId: TABLE_ID,
          fieldsAdded: [],
          fieldsUpdated: [],
          fieldsDeleted: [],
          viewsAdded: [],
          viewsUpdated: [],
          viewsDeleted: [],
          recordsAdded: [],
          recordsUpdated: [],
          recordsDeleted: [
            {
              recordId: `rec${'1'.repeat(16)}`,
              before: { id: `rec${'1'.repeat(16)}`, fields: { [FIELD_READABLE]: 'a' } },
            },
          ],
        },
      ],
    });
    expect(deniedRecordDelete.isErr()).toBe(true);
    expect(deniedRecordDelete._unsafeUnwrapErr().code).toBe('vcs.field_write_forbidden');

    // Deleting a table while a field is restricted / row-filtered is denied
    (permissions.validPermissions as ReturnType<typeof vi.fn>).mockResolvedValue([
      'table|read',
      'table|delete',
    ]);
    const deniedTableDelete = await policy.assertCanApplyPatch(ctx, baseIdVo, {
      tablesAdded: [],
      tablesDeleted: [
        {
          tableId: TABLE_ID,
          tableName: 'Tasks',
          before: {
            id: TABLE_ID,
            name: 'Tasks',
            primaryFieldId: FIELD_READABLE,
            fields: [
              {
                id: FIELD_READABLE,
                name: 'Title',
                type: 'singleLineText',
                isPrimary: true,
                isComputed: false,
              },
            ],
            views: [],
            records: [],
          },
        },
      ],
      tablesUpdated: [],
    });
    expect(deniedTableDelete.isErr()).toBe(true);
    expect(deniedTableDelete._unsafeUnwrapErr().code).toBe('vcs.filtered_table_delete_forbidden');

    // assertCanEnableVcs enforces base|update
    (permissions.validPermissions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ForbiddenException('missing base|update')
    );
    const deniedEnable = await policy.assertCanEnableVcs(ctx, baseIdVo);
    expect(deniedEnable.isErr()).toBe(true);
    expect(deniedEnable._unsafeUnwrapErr().tags).toContain('forbidden');

    (permissions.validPermissions as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'base|update',
    ]);
    const allowedEnable = await policy.assertCanEnableVcs(ctx, baseIdVo);
    expect(allowedEnable.isOk()).toBe(true);

    // Non-403 errors from PermissionService.getPermissions propagate instead of returning []
    (permissions.getPermissions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new HttpException('DB unavailable', HttpStatus.INTERNAL_SERVER_ERROR)
    );
    await expect(policy.resolveReadableTables(ctx, baseIdVo)).rejects.toThrow('DB unavailable');
  });
});
