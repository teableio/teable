/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { APP_ROBOT_ID, HttpErrorCode, type Action } from '@teable/core';
import { BASE_SHARE_ID_HEADER } from '@teable/openapi';
import type { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import {
  BASE_SHARE_DENIED_MESSAGE,
  IS_ALLOW_BASE_SHARE,
} from '../decorators/allow-base-share.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
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

  it('checks the table resource when a share grants access through an open project table route', async () => {
    class SharePermissionGuard extends PermissionGuard {
      checkShare(context: ExecutionContext) {
        return this.baseSharePermissionCheck(context, 'shrFixture');
      }
    }

    const baseId = 'bseFixture';
    const context = createContext();
    context.switchToHttp = (() => ({
      getRequest: () => ({ params: { baseId, tableId } }),
    })) as typeof context.switchToHttp;
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === 'permissions' ? ['table|read'] : key === IS_ALLOW_BASE_SHARE || undefined
      ),
    } as unknown as Reflector;
    const cls = {
      get: vi.fn((key: string) => (key === 'baseShare' ? { baseId } : undefined)),
      set: vi.fn(),
    } as unknown as ClsService<IClsStore>;
    const validBaseSharePermissions = vi.fn().mockResolvedValue(['table|read']);
    const permissionService = {
      baseShareRequiresPassword: vi.fn().mockResolvedValue(false),
      validBaseSharePermissions,
    } as unknown as PermissionService;

    const guard = new SharePermissionGuard(reflector, cls, permissionService);
    await expect(guard.checkShare(context)).resolves.toBe(true);
    expect(validBaseSharePermissions).toHaveBeenCalledWith('shrFixture', tableId, ['table|read']);
  });

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

describe('PermissionGuard with a project share header', () => {
  const baseId = 'bsexxxxxxxxxxxx';
  const shareId = 'shrxxxxxxxxxxxx';

  const createShareGuard = ({
    allowBaseShare,
    shareBaseId = baseId,
  }: {
    allowBaseShare?: boolean;
    shareBaseId?: string;
  }) => {
    const metadata: Record<string, unknown> = {
      [PERMISSIONS_KEY]: ['table|read'],
      [IS_ALLOW_BASE_SHARE]: allowBaseShare,
    };
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => metadata[key]),
    } as unknown as Reflector;
    const store = new Map<string, unknown>([['user.id', 'usrxxxxxxxxxxxx']]);
    const cls = {
      get: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: unknown) => store.set(key, value)),
    } as unknown as ClsService<IClsStore>;
    // The share service records the share it checked, as the real one does
    const validBaseSharePermissions = vi.fn(async () => {
      store.set('baseShare', { baseId: shareBaseId, nodeId: 'bnoxxxxxxxxxxxx' });
      return ['table|read'];
    });
    const permissionService = {
      getBaseShareIdByHeader: (header: string) => header,
      baseShareRequiresPassword: vi.fn().mockResolvedValue(false),
      validBaseSharePermissions,
    } as unknown as PermissionService;
    return {
      guard: new PermissionGuard(reflector, cls, permissionService),
      validBaseSharePermissions,
    };
  };

  const createShareContext = (params: Record<string, string>) =>
    ({
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          params,
          headers: { [BASE_SHARE_ID_HEADER.toLowerCase()]: shareId },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('refuses a project-level route that is not opened to shares', async () => {
    const { guard, validBaseSharePermissions } = createShareGuard({});

    await expect(guard.canActivate(createShareContext({ baseId }))).rejects.toThrow(
      BASE_SHARE_DENIED_MESSAGE
    );
    expect(validBaseSharePermissions).not.toHaveBeenCalled();
  });

  it('checks an open project-level route against the base when the path names nothing else', async () => {
    const { guard, validBaseSharePermissions } = createShareGuard({ allowBaseShare: true });

    await expect(guard.canActivate(createShareContext({ baseId }))).resolves.toBe(true);
    expect(validBaseSharePermissions).toHaveBeenCalledWith(shareId, baseId, ['table|read']);
  });

  it("refuses a route under a shared table's path that is not opened to shares", async () => {
    const { guard, validBaseSharePermissions } = createShareGuard({});

    // e.g. delete-references, which answers for the tables elsewhere that point at this one
    await expect(guard.canActivate(createShareContext({ baseId, tableId }))).rejects.toThrow(
      BASE_SHARE_DENIED_MESSAGE
    );
    expect(validBaseSharePermissions).not.toHaveBeenCalled();
  });

  it('checks the table an open project-level route names against the share', async () => {
    const { guard, validBaseSharePermissions } = createShareGuard({ allowBaseShare: true });

    await expect(guard.canActivate(createShareContext({ baseId, tableId }))).resolves.toBe(true);
    expect(validBaseSharePermissions).toHaveBeenCalledWith(shareId, tableId, ['table|read']);
  });

  it("refuses a shared table under another project's id", async () => {
    const { guard } = createShareGuard({ allowBaseShare: true, shareBaseId: 'bseyyyyyyyyyyyy' });

    await expect(guard.canActivate(createShareContext({ baseId, tableId }))).rejects.toThrow(
      `Resource ${baseId} is not accessible via share ${shareId}`
    );
  });

  it('leaves a table-level route to the share check of its table', async () => {
    const { guard, validBaseSharePermissions } = createShareGuard({});

    await expect(guard.canActivate(createShareContext({ tableId }))).resolves.toBe(true);
    expect(validBaseSharePermissions).toHaveBeenCalledWith(shareId, tableId, ['table|read']);
  });
});
