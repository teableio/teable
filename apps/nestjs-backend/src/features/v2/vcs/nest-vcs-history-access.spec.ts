import { Role, cliOAuthApp, type Action } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { ActorId, BaseId, ok } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi } from 'vitest';

import type { IClsStore } from '../../../types/cls';
import type { PermissionService } from '../../auth/permission.service';
import { NestVcsAccessPolicy } from './nest-vcs-access-policy.service';
import { VCS_HISTORY_AUTHORITY } from './vcs-history-authority';

vi.mock('../v2-delete-preview-resource-authorization', () => ({
  getTableDeletePreviewAuthorization: () => ({ canReadResource: async () => ok(true) }),
}));

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const ctx = { actorId: ActorId.create('usr_history')._unsafeUnwrap() };

// History may contain a whole table even when the actor's live query returns no tables.
async function resolveEmptyBaseAccess(
  role: string,
  request: Record<string, unknown> = {},
  liveCount = 0,
  tokenActions: Action[] = [],
  {
    clientId,
    tokenScopes = tokenActions,
    ee = false,
    baseReadable = true,
  }: { clientId?: string; tokenScopes?: Action[]; ee?: boolean; baseReadable?: boolean } = {}
) {
  const store: Record<string, unknown> = { 'user.id': ctx.actorId.toString(), ...request };
  const policy = new NestVcsAccessPolicy(
    {
      tableMeta: { count: async () => liveCount },
      base: { findUnique: async () => null },
    } as unknown as PrismaService,
    {
      getPermissions: async () => tokenActions,
      getAccessToken: async () => ({ clientId, scopes: tokenScopes }),
      validPermissions: async () => (baseReadable ? ['base|read'] : []),
      getUpperIdByBaseId: async () => ({ spaceId: 'space' }),
      getRoleBySpaceId: async () => role,
      getBaseShareVisibleResourceIds: async () => undefined,
    } as unknown as PermissionService,
    { get: (key: string) => store[key] } as unknown as ClsService<IClsStore>
  );
  const container = {
    resolve: (token: unknown) =>
      token === VCS_HISTORY_AUTHORITY
        ? { resolveTableGrant: vi.fn(), resolveRecordHistoryWindow: vi.fn() }
        : { execute: async () => ok({ tables: [] }) },
    isRegistered: (token: unknown) => ee && token === VCS_HISTORY_AUTHORITY,
  } as unknown as DependencyContainer;
  return policy.forContainer(container).resolveHistoryAccess!(ctx, baseId);
}

async function resolveEmptyBase(...args: Parameters<typeof resolveEmptyBaseAccess>) {
  return (await resolveEmptyBaseAccess(...args))._unsafeUnwrap();
}

describe('Nest VCS history grant', () => {
  it('limits a space owner to this base, including its deleted tables', async () => {
    expect(await resolveEmptyBase(Role.Owner)).toEqual({ kind: 'full' });
  });

  it('allows same-base historical reads with an owner token carrying every required read scope', async () => {
    const token = { accessTokenId: 'owner-token' };
    const actions: Action[] = [
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

  const officialToken = { accessTokenId: 'official-cli-token' };
  const officialClient = { clientId: cliOAuthApp.clientId };

  it('asks an official CLI login with a legacy token to approve history access again', async () => {
    const legacy = cliOAuthApp.scopes.filter((scope) => scope !== 'table_record_history|read');
    const result = await resolveEmptyBaseAccess(Role.Owner, officialToken, 0, legacy, officialClient);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'vcs.missing_history_scope',
      tags: ['forbidden'],
      message: expect.stringMatching(/table_record_history\|read.*teable auth login.*TEABLE_TOKEN/),
    });
  });

  it('requires record update for EE history from an explicitly scoped official CLI login', async () => {
    const limited: Action[] = [
      'base|read',
      'table|read',
      'field|read',
      'record|read',
      'table_record_history|read',
    ];
    const result = await resolveEmptyBaseAccess(Role.Owner, officialToken, 0, limited, {
      ...officialClient,
      ee: true,
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'vcs.missing_history_scope',
      tags: ['forbidden'],
      message: expect.stringContaining('record|update'),
    });
    expect(await resolveEmptyBase(Role.Viewer, officialToken, 0, limited, officialClient)).toEqual({
      kind: 'scoped',
      tables: [],
    });
  });

  it('keeps base ACL denial ahead of official CLI token diagnostics', async () => {
    const result = await resolveEmptyBaseAccess(Role.Viewer, officialToken, 0, [], {
      ...officialClient,
      baseReadable: false,
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({ code: 'vcs.forbidden' });
  });

  it('projects the user permissions of an EE member with a fully scoped official CLI login', async () => {
    expect(
      await resolveEmptyBase(Role.Viewer, officialToken, 0, ['base|read'], {
        ...officialClient,
        tokenScopes: cliOAuthApp.scopes,
        ee: true,
      })
    ).toEqual({ kind: 'scoped', tables: [], currentBaseName: baseId.toString() });
  });

  it('does not require CLI history scopes from an unrelated OAuth client', async () => {
    expect(
      await resolveEmptyBase(Role.Owner, { accessTokenId: 'oauth-token' }, 0, ['base|read'], {
        clientId: 'clt_other_client',
      })
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
