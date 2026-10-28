import { HttpErrorCode } from '@teable/core';
import {
  FieldOperationKind,
  FieldOperationTargetKind,
  type FieldOperationPluginContext,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../custom.exception';
import {
  SYMMETRIC_FIELD_PERMISSION_FORBIDDEN,
  SymmetricFieldPermissionFieldOperationPlugin,
} from './symmetric-field-permission.field-operation.plugin';
import { SymmetricFieldTargetSchemaCapabilityProvider } from './symmetric-field-target-schema-capability.service';

const SOURCE_TABLE_ID = `tbl${'s'.repeat(16)}`;
const TARGET_TABLE_ID = `tbl${'t'.repeat(16)}`;
const SOURCE_BASE_ID = `bse${'s'.repeat(16)}`;
const TARGET_BASE_ID = `bse${'t'.repeat(16)}`;
const ACTOR_ID = `usr${'a'.repeat(16)}`;
const OTHER_USER_ID = `usr${'b'.repeat(16)}`;
const ACCESS_TOKEN_ID = `act${'c'.repeat(16)}`;
const USER_ID_KEY = 'user.id';

type SupportedOperation = 'create' | 'update' | 'delete';

const table = (id: string, baseId: string) => ({
  id: () => ({ toString: () => id }),
  baseId: () => ({ toString: () => baseId }),
});

const context = (
  options: {
    kind?: SupportedOperation;
    targetKind?: 'direct' | 'sideEffect';
    sourceBaseId?: string;
    targetBaseId?: string;
    actorId?: string;
  } = {}
) => {
  const kind = options.kind ?? FieldOperationKind.create;
  const sourceTable = table(SOURCE_TABLE_ID, options.sourceBaseId ?? SOURCE_BASE_ID);

  return {
    kind,
    executionContext: {
      actorId: { toString: () => options.actorId ?? ACTOR_ID },
    },
    table: table(TARGET_TABLE_ID, options.targetBaseId ?? TARGET_BASE_ID),
    target: {
      kind: options.targetKind ?? FieldOperationTargetKind.sideEffect,
      sourceOperation: kind,
      sourceTable,
    },
    payload: {},
    isTransactionBound: false,
  } as unknown as FieldOperationPluginContext;
};

const createPlugin = (clsOverrides: Record<string, unknown> = {}) => {
  const validPermissions = vi.fn().mockResolvedValue([]);
  const clsValues: Record<string, unknown> = {
    [USER_ID_KEY]: ACTOR_ID,
    accessTokenId: ACCESS_TOKEN_ID,
    ...clsOverrides,
  };
  const cls = { get: vi.fn((key: string) => clsValues[key]) };
  const targetSchemaCapability = new SymmetricFieldTargetSchemaCapabilityProvider({
    validPermissions,
  } as never);
  const plugin = new SymmetricFieldPermissionFieldOperationPlugin(
    targetSchemaCapability,
    cls as never
  );

  return { plugin, validPermissions, cls };
};

describe('SymmetricFieldPermissionFieldOperationPlugin', () => {
  it.each([
    [FieldOperationKind.create, 'field|create'],
    [FieldOperationKind.update, 'field|update'],
    [FieldOperationKind.delete, 'field|delete'],
  ] as const)(
    'requires %s permission on the actual cross-base side-effect table',
    async (kind, action) => {
      const { plugin, validPermissions } = createPlugin();

      const result = await plugin.prepare(context({ kind }));

      expect(result.isOk()).toBe(true);
      expect(validPermissions).toHaveBeenCalledOnce();
      expect(validPermissions).toHaveBeenCalledWith(TARGET_TABLE_ID, [action], ACCESS_TOKEN_ID);
    }
  );

  it('authorizes undo side effects by their actual mutation kind', async () => {
    const { plugin, validPermissions } = createPlugin();
    const deleteContext = context({ kind: FieldOperationKind.delete });

    const result = await plugin.prepare({
      ...deleteContext,
      executionContext: {
        ...deleteContext.executionContext,
        undoRedo: { mode: 'undo' as const },
      },
    });

    expect(result.isOk()).toBe(true);
    expect(validPermissions).toHaveBeenCalledWith(
      TARGET_TABLE_ID,
      ['field|delete'],
      ACCESS_TOKEN_ID
    );
  });

  it('leaves direct cross-base references to their route and host policy', async () => {
    const { plugin, validPermissions } = createPlugin();

    const result = await plugin.prepare(context({ targetKind: FieldOperationTargetKind.direct }));

    expect(result.isOk()).toBe(true);
    expect(validPermissions).not.toHaveBeenCalled();
  });

  it('does not add a redundant permission check to same-base side effects', async () => {
    const { plugin, validPermissions } = createPlugin();

    const result = await plugin.prepare(context({ targetBaseId: SOURCE_BASE_ID }));

    expect(result.isOk()).toBe(true);
    expect(validPermissions).not.toHaveBeenCalled();
  });

  it('recognizes only the explicit system actor as an internal operation', async () => {
    const { plugin, validPermissions } = createPlugin({ [USER_ID_KEY]: undefined });

    const result = await plugin.prepare(context({ actorId: 'system' }));

    expect(result.isOk()).toBe(true);
    expect(validPermissions).not.toHaveBeenCalled();
  });

  it.each([undefined, OTHER_USER_ID])(
    'fails closed when the execution actor does not match CLS user %s',
    async (userId) => {
      const { plugin, validPermissions } = createPlugin({ [USER_ID_KEY]: userId });

      const result = await plugin.prepare(context({ kind: FieldOperationKind.update }));

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(SYMMETRIC_FIELD_PERMISSION_FORBIDDEN);
      expect(error.tags).toContain('forbidden');
      expect(error.details).toEqual({
        operation: FieldOperationKind.update,
        sourceOperation: FieldOperationKind.update,
        sourceTableId: SOURCE_TABLE_ID,
        targetTableId: TARGET_TABLE_ID,
        action: 'field|update',
      });
      expect(validPermissions).not.toHaveBeenCalled();
    }
  );

  it('preserves a permission denial message and localization as a forbidden domain error', async () => {
    const { plugin, validPermissions } = createPlugin();
    const rejection = new CustomHttpException(
      `not allowed to operate field|delete on ${TARGET_TABLE_ID}`,
      HttpErrorCode.RESTRICTED_RESOURCE,
      {
        localization: {
          i18nKey: 'httpErrors.permission.notAllowedOperation',
          context: { action: 'field|delete' },
        },
      }
    );
    validPermissions.mockRejectedValue(rejection);

    const result = await plugin.prepare(context({ kind: FieldOperationKind.delete }));

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(SYMMETRIC_FIELD_PERMISSION_FORBIDDEN);
    expect(error.message).toBe(rejection.message);
    expect(error.tags).toContain('forbidden');
    expect(error.localization).toEqual(rejection.data?.localization);
    expect(error.cause).toBe(rejection);
    expect(error.details).toEqual({
      operation: FieldOperationKind.delete,
      sourceOperation: FieldOperationKind.delete,
      sourceTableId: SOURCE_TABLE_ID,
      targetTableId: TARGET_TABLE_ID,
      action: 'field|delete',
    });
  });

  it('propagates failures outside the permission boundary', async () => {
    const { plugin, validPermissions } = createPlugin();
    const failure = new Error('permission store unavailable');
    validPermissions.mockRejectedValue(failure);

    await expect(plugin.prepare(context())).rejects.toBe(failure);
  });

  it('passes scoped robot and temporary-auth callers through the exact target permission check', async () => {
    const robotActorId = 'appRobot';
    const { plugin, validPermissions, cls } = createPlugin({
      [USER_ID_KEY]: robotActorId,
      tempAuthBaseId: SOURCE_BASE_ID,
      shareViewId: 'viwShare',
    });

    const result = await plugin.prepare(context({ actorId: robotActorId }));

    expect(result.isOk()).toBe(true);
    expect(validPermissions).toHaveBeenCalledWith(
      TARGET_TABLE_ID,
      ['field|create'],
      ACCESS_TOKEN_ID
    );
    expect(cls.get).not.toHaveBeenCalledWith('tempAuthBaseId');
    expect(cls.get).not.toHaveBeenCalledWith('shareViewId');
  });
});
