import type { Response } from 'express';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import type { AuditScope } from '../audit/audit-scope';
import type { DeleteUserService } from '../user/delete-user/delete-user.service';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { SessionService } from './session/session.service';

const USER_ID = 'usr1';

function makeController(
  deleteUser: () => Promise<{ trashedSpaceIds: string[] }> = async () => ({
    trashedSpaceIds: ['spc1', 'spc2'],
  })
) {
  const calls: string[] = [];
  const audit = {
    emitAtomic: vi.fn(async () => {
      calls.push('audit');
    }),
  };
  const sessionService = {
    signout: vi.fn(async () => {
      calls.push('signout');
    }),
  };
  const deleteUserService = {
    deleteUser: vi.fn(async () => {
      const summary = await deleteUser();
      calls.push('delete');
      return summary;
    }),
  };
  const cls = { get: vi.fn((key: string) => (key === 'user.id' ? USER_ID : undefined)) };
  const controller = new AuthController(
    {} as AuthService,
    sessionService as unknown as SessionService,
    cls as unknown as ClsService<IClsStore>,
    deleteUserService as unknown as DeleteUserService,
    audit as unknown as AuditScope
  );
  return { controller, audit, deleteUserService, sessionService, calls };
}

const res = () => ({ clearCookie: vi.fn() }) as unknown as Response;

describe('AuthController.deleteUser audit', () => {
  it('writes user.delete with the trashed spaces after the deletion, before signing out', async () => {
    const ctx = makeController();

    await ctx.controller.deleteUser({} as Express.Request, res(), {
      confirm: 'DELETE',
      spaceIds: ['spc1', 'spc2'],
    });

    expect(ctx.deleteUserService.deleteUser).toHaveBeenCalledWith(['spc1', 'spc2']);
    expect(ctx.audit.emitAtomic).toHaveBeenCalledWith({
      action: 'user.delete',
      resourceId: USER_ID,
      userId: USER_ID,
      params: { trashedSpaceCount: 2, trashedSpaceIds: ['spc1', 'spc2'] },
    });
    // The row is written once the account is gone and while the session still names the actor.
    expect(ctx.calls).toEqual(['delete', 'audit', 'signout']);
  });

  it('writes no row when the deletion fails', async () => {
    const ctx = makeController(async () => {
      throw new Error('sole owner of spaces');
    });

    await expect(
      ctx.controller.deleteUser({} as Express.Request, res(), { confirm: 'DELETE' })
    ).rejects.toThrow('sole owner of spaces');
    expect(ctx.audit.emitAtomic).not.toHaveBeenCalled();
    expect(ctx.sessionService.signout).not.toHaveBeenCalled();
  });

  it('writes no row without the confirmation word', async () => {
    const ctx = makeController();

    await expect(
      ctx.controller.deleteUser({} as Express.Request, res(), { confirm: 'nope' })
    ).rejects.toThrow('Invalid confirm');
    expect(ctx.deleteUserService.deleteUser).not.toHaveBeenCalled();
    expect(ctx.audit.emitAtomic).not.toHaveBeenCalled();
  });
});
