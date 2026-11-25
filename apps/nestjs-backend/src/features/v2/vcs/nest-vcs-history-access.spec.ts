import { Role } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { ActorId, BaseId, ok } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';

import type { IClsStore } from '../../../types/cls';
import type { PermissionService } from '../../auth/permission.service';
import { NestVcsAccessPolicy } from './nest-vcs-access-policy.service';

vi.mock('../v2-delete-preview-resource-authorization', () => ({
  getTableDeletePreviewAuthorization: () => ({ canReadResource: async () => ok(true) }),
}));

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const ctx = { actorId: ActorId.create('usr_history')._unsafeUnwrap() };

// History may contain a whole table even when the actor's live query returns no tables.
async function resolveEmptyBase(
  role: string,
  request: Record<string, unknown> = {},
  liveCount = 0,
  tokenActions: string[] = []
) {
  const store: Record<string, unknown> = { 'user.id': ctx.actorId.toString(), ...request };
  const policy = new NestVcsAccessPolicy(
    { tableMeta: { count: async () => liveCount } } as unknown as PrismaService,
    {
      getPermissions: async () => tokenActions,
      validPermissions: async () => ['base|read'],
      getUpperIdByBaseId: async () => ({ spaceId: 'space' }),
      getRoleBySpaceId: async () => role,
      getBaseShareVisibleResourceIds: async () => undefined,
    } as unknown as PermissionService,
    { get: (key: string) => store[key] } as unknown as ClsService<IClsStore>
  );
  const container = {
    resolve: () => ({ execute: async () => ok({ tables: [] }) }),
    isRegistered: () => false,
  } as unknown as DependencyContainer;
  return (await policy.forContainer(container).resolveHistoryAccess!(ctx, baseId))._unsafeUnwrap();
}

describe('Nest VCS history grant', () => {
  it('limits a space owner to this base, including its deleted tables', async () => {
    expect(await resolveEmptyBase(Role.Owner)).toEqual({ kind: 'full' });
  });

  it('allows same-base historical reads with an owner token carrying every required read scope', async () => {
    const token = { accessTokenId: 'owner-token' };
    const actions = [
      'base|read_all',
      'table|read',
      'table|trash_read',
      'table|archive_read',
      'field|read',
      'view|read',
      'record|read',
      'table_record_history|read',
    ];
    expect(await resolveEmptyBase(Role.Owner, token, 0, actions)).toEqual({ kind: 'full' });
    expect(
      await resolveEmptyBase(
        Role.Owner,
        token,
        0,
        actions.filter((a) => a !== 'table_record_history|read')
      )
    ).toEqual({ kind: 'scoped', tables: [] });
  });

  it('requires an unrestricted owner credential even when every returned live table was readable', async () => {
    const scoped = { kind: 'scoped', tables: [] };
    expect(await resolveEmptyBase(Role.Viewer)).toEqual(scoped);
    expect(await resolveEmptyBase(Role.Creator)).toEqual(scoped);
    expect(await resolveEmptyBase(Role.Owner, { accessTokenId: 'token' })).toEqual(scoped);
    expect(
      await resolveEmptyBase(Role.Owner, { baseShare: { baseId: baseId.toString() } })
    ).toEqual(scoped);
    expect(await resolveEmptyBase(Role.Owner, {}, 1)).toEqual(scoped);
  });
});
