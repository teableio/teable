/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { APP_ROBOT_ID, HttpErrorCode, type Action } from '@teable/core';
import type { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import type { PermissionService } from '../permission.service';
import { PermissionGuard } from './permission.guard';

vi.mock('../permission.service', () => ({
  PermissionService: class PermissionService {},
}));

const tableId = 'tblxxxxxxxxxxxx';
const tableUpdatePermissions: Action[] = ['table|update'];
const instanceUpdatePermissions: Action[] = ['instance|update'];

const createContext = (): ExecutionContext =>
  ({
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        params: { tableId },
        headers: {},
      }),
    }),
  }) as unknown as ExecutionContext;

const createForbiddenError = (permissions: Action[]) =>
  new CustomHttpException(
    `not allowed to operate ${permissions.join(', ')} on ${tableId}`,
    HttpErrorCode.RESTRICTED_RESOURCE
  );

describe('PermissionGuard', () => {
  const createGuard = ({
    primaryPermissions,
    anyPermissions,
    isAdmin = false,
    userId = 'usrxxxxxxxxxxxx',
    tempAuthBaseId,
    authSource,
    validPermissions,
  }: {
    primaryPermissions: Action[];
    anyPermissions?: Action[][];
    isAdmin?: boolean;
    userId?: string;
    tempAuthBaseId?: string;
    authSource?: string;
    validPermissions: PermissionService['validPermissions'];
  }) => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => {
        if (key === 'permissions') {
          return primaryPermissions;
        }
        if (key === 'anyPermissions') {
          return anyPermissions;
        }
        return undefined;
      }),
    } as unknown as Reflector;
    const cls = {
      get: vi.fn((key: string) => {
        if (key === 'user.id') {
          return userId;
        }
        if (key === 'user.isAdmin') {
          return isAdmin;
        }
        if (key === 'tempAuthBaseId') {
          return tempAuthBaseId;
        }
        if (key === 'authSource') {
          return authSource;
        }
        return undefined;
      }),
      set: vi.fn(),
    } as unknown as ClsService<IClsStore>;
    const permissionService = {
      validPermissions,
    } as unknown as PermissionService;

    return {
      guard: new PermissionGuard(reflector, cls, permissionService),
      cls,
      permissionService,
    };
  };

  it('keeps table update as the primary permission for alternative permission routes', async () => {
    const validPermissions = vi.fn().mockResolvedValue(tableUpdatePermissions);
    const { guard, cls } = createGuard({
      primaryPermissions: tableUpdatePermissions,
      anyPermissions: [instanceUpdatePermissions],
      validPermissions,
    });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);

    expect(validPermissions).toHaveBeenCalledWith(tableId, tableUpdatePermissions, undefined);
    expect(cls.get).not.toHaveBeenCalledWith('user.isAdmin');
  });

  it('allows instance admins through alternative permissions when table update is unavailable', async () => {
    const validPermissions = vi
      .fn()
      .mockRejectedValue(createForbiddenError(tableUpdatePermissions));
    const { guard } = createGuard({
      primaryPermissions: tableUpdatePermissions,
      anyPermissions: [instanceUpdatePermissions],
      isAdmin: true,
      validPermissions,
    });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
  });

  it('still rejects users without table update or instance update', async () => {
    const validPermissions = vi
      .fn()
      .mockRejectedValue(createForbiddenError(tableUpdatePermissions));
    const { guard } = createGuard({
      primaryPermissions: tableUpdatePermissions,
      anyPermissions: [instanceUpdatePermissions],
      validPermissions,
    });

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      `not allowed to operate table|update on ${tableId}`
    );
  });

  it.each<Action>(['instance|read', 'instance|update'])(
    "denies an admin's base-scoped internal token the instance permission %s",
    async (permission) => {
      const { guard } = createGuard({
        primaryPermissions: [permission],
        isAdmin: true,
        tempAuthBaseId: 'bsexxxxxxxxxxxx',
        validPermissions: vi.fn(),
      });

      await expect(guard.canActivate(createContext())).rejects.toThrow(
        `Base-scoped token cannot perform ${permission}`
      );
    }
  );

  it.each<Action>(['instance|read', 'instance|update'])(
    "denies an admin's AI sandbox token the instance permission %s",
    async (permission) => {
      const { guard } = createGuard({
        primaryPermissions: [permission],
        isAdmin: true,
        authSource: 'sandbox',
        validPermissions: vi.fn(),
      });

      await expect(guard.canActivate(createContext())).rejects.toThrow(
        `Sandbox token cannot perform ${permission}`
      );
    }
  );

  it("keeps an admin's AI sandbox token to the user's own permissions on alternative routes", async () => {
    const validPermissions = vi
      .fn()
      .mockRejectedValue(createForbiddenError(tableUpdatePermissions));
    const { guard } = createGuard({
      primaryPermissions: tableUpdatePermissions,
      anyPermissions: [instanceUpdatePermissions],
      isAdmin: true,
      authSource: 'sandbox',
      validPermissions,
    });

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      `not allowed to operate table|update on ${tableId}`
    );
  });

  it('allows an admin session the instance permission', async () => {
    const { guard } = createGuard({
      primaryPermissions: ['instance|read'],
      isAdmin: true,
      validPermissions: vi.fn(),
    });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
  });

  it('allows a signed-in user the user-level space|create permission', async () => {
    const { guard } = createGuard({
      primaryPermissions: ['space|create'],
      validPermissions: vi.fn(),
    });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
  });

  it.each<Action>(['space|create', 'base|read_all', 'user|integrations'])(
    'denies robot identities the user-level permission %s',
    async (permission) => {
      const validPermissions = vi.fn();
      const { guard } = createGuard({
        primaryPermissions: [permission],
        userId: APP_ROBOT_ID,
        validPermissions,
      });

      await expect(guard.canActivate(createContext())).resolves.toBe(false);
      expect(validPermissions).not.toHaveBeenCalled();
    }
  );
});
