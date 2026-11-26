/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Action } from '@teable/core';
import {
  APP_ROBOT_ID,
  AUTOMATION_ROBOT_ID,
  HttpErrorCode,
  Role,
  TemplatePermissions,
  getPermissions,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { noop } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { DeepMockProxy } from 'vitest-mock-extended';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { getError } from '../../../test/utils/get-error';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { hashSharePassword } from '../../utils/share-password-hash';
import { PermissionModule } from './permission.module';
import { PermissionService } from './permission.service';

describe('PermissionService', () => {
  let service: PermissionService;
  let module: TestingModule;
  let prismaServiceMock: DeepMockProxy<PrismaService>;
  let clsServiceMock: DeepMockProxy<ClsService<IClsStore>>;

  beforeEach(async () => {
    prismaServiceMock = mockDeep<PrismaService>();
    clsServiceMock = mockDeep<ClsService<IClsStore>>();

    module = await Test.createTestingModule({
      imports: [GlobalModule, PermissionModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaServiceMock)
      .overrideProvider(ClsService)
      .useValue(clsServiceMock)
      .compile();

    service = module.get<PermissionService>(PermissionService);
  });

  afterEach(async () => {
    await module.close();
    mockReset(prismaServiceMock);
    mockReset(clsServiceMock);
  });

  describe('Base share scope', () => {
    const baseId = 'bseShared';
    const shareId = 'shrFixture';
    const sharedTableId = 'tblShared';
    const siblingTableId = 'tblSibling';

    beforeEach(() => {
      prismaServiceMock.tableMeta.findUnique.mockResolvedValue({ baseId } as never);
      prismaServiceMock.baseNode.findMany.mockResolvedValue([
        { id: 'bnoFolder', parentId: null, resourceType: 'folder', resourceId: null },
        { id: 'bnoNested', parentId: 'bnoFolder', resourceType: 'folder', resourceId: null },
        {
          id: 'bnoShared',
          parentId: 'bnoNested',
          resourceType: 'table',
          resourceId: sharedTableId,
        },
        { id: 'bnoSibling', parentId: null, resourceType: 'table', resourceId: siblingTableId },
      ] as never);
    });

    it.each(['bnoShared', 'bnoFolder'])(
      'uses the scope rooted at %s for table reads',
      async (nodeId) => {
        prismaServiceMock.baseShare.findFirst.mockResolvedValue({ baseId, nodeId } as never);
        prismaServiceMock.field.findMany.mockResolvedValue([
          { options: JSON.stringify({ foreignTableId: siblingTableId }) },
        ] as never);

        await expect(service.getBaseSharePermissions(shareId, sharedTableId)).resolves.toContain(
          'record|read'
        );
        await expect(
          service.getBaseSharePermissions(shareId, siblingTableId)
        ).rejects.toMatchObject({
          code: HttpErrorCode.RESTRICTED_RESOURCE,
        });
      }
    );

    it('bounds editor permissions to the selected subtree', async () => {
      prismaServiceMock.baseShare.findFirst.mockResolvedValue({
        baseId,
        nodeId: 'bnoFolder',
        allowEdit: true,
      } as never);
      clsServiceMock.get.mockImplementation(((key: string) =>
        key === 'user.id' ? 'usrEditor' : undefined) as typeof clsServiceMock.get);

      await expect(
        service.validBaseSharePermissions(shareId, sharedTableId, ['record|update'])
      ).resolves.toContain('record|update');
      await expect(
        service.validBaseSharePermissions(shareId, siblingTableId, ['record|update'])
      ).rejects.toMatchObject({ code: HttpErrorCode.RESTRICTED_RESOURCE });
    });

    it.each([false, true])(
      'requires a whole-project share for project queries (edit: %s)',
      async (allowEdit) => {
        clsServiceMock.get.mockImplementation(((key: string) =>
          key === 'user.id' ? 'usrEditor' : undefined) as typeof clsServiceMock.get);
        prismaServiceMock.baseShare.findFirst.mockResolvedValue({
          baseId,
          nodeId: 'bnoFolder',
          allowEdit,
        } as never);
        await expect(
          service.validBaseSharePermissions(shareId, baseId, ['base|query_data'])
        ).rejects.toMatchObject({ code: HttpErrorCode.RESTRICTED_RESOURCE });

        prismaServiceMock.baseShare.findFirst.mockResolvedValue({
          baseId,
          nodeId: null,
          allowEdit,
        } as never);
        await expect(
          service.validBaseSharePermissions(shareId, baseId, ['base|query_data'])
        ).resolves.toContain('base|query_data');
      }
    );

    it('allows live tables within a whole-base share', async () => {
      prismaServiceMock.baseShare.findFirst.mockResolvedValue({ baseId, nodeId: null } as never);

      await expect(service.getBaseSharePermissions(shareId, siblingTableId)).resolves.toContain(
        'record|read'
      );
      prismaServiceMock.tableMeta.findUnique.mockResolvedValue({ baseId: 'bseOther' } as never);
      await expect(service.getBaseSharePermissions(shareId, siblingTableId)).rejects.toMatchObject({
        code: HttpErrorCode.RESTRICTED_RESOURCE,
      });
    });
  });

  describe('getRoleBySpaceId', () => {
    it('should return a SpaceRole', async () => {
      const spaceId = 'space-id';
      const roleName = 'space-role';
      prismaServiceMock.collaborator.findMany.mockResolvedValue([{ roleName } as any]);
      prismaServiceMock.space.findUnique.mockResolvedValue({ deletedTime: null } as any);
      const result = await service['getRoleBySpaceId'](spaceId);
      expect(result).toBe(roleName);
    });

    it('should throw a ForbiddenException if collaborator is not found', async () => {
      const spaceId = 'space-id1';
      prismaServiceMock.collaborator.findMany.mockResolvedValue([]);
      prismaServiceMock.space.findUnique.mockResolvedValue({ deletedTime: null } as any);
      const res = await service['getRoleBySpaceId'](spaceId);
      expect(res).toBeNull();
    });

    it('should ignore collaborator rows when the user is a robot identity', async () => {
      clsServiceMock.get.mockImplementation(((key: string) =>
        key === 'user.id' ? APP_ROBOT_ID : undefined) as any);
      prismaServiceMock.collaborator.findMany.mockResolvedValue([
        { roleName: Role.Owner, principalId: APP_ROBOT_ID } as any,
      ]);
      prismaServiceMock.space.findUnique.mockResolvedValue({ deletedTime: null } as any);
      const res = await service['getRoleBySpaceId']('space-id');
      expect(res).toBeNull();
    });
  });

  describe('getRoleByBaseId', () => {
    it('should return a BaseRole', async () => {
      const baseId = 'base-id';
      const roleName = 'base-role';
      prismaServiceMock.collaborator.findMany.mockResolvedValue([{ roleName } as any]);
      const result = await service['getRoleByBaseId'](baseId);
      expect(result).toBe(roleName);
    });

    it('should return null if collaborator is not found', async () => {
      const baseId = 'base-id1';
      prismaServiceMock.collaborator.findMany.mockResolvedValue([]);
      const result = await service['getRoleByBaseId'](baseId);
      expect(result).toBeNull();
    });

    it('should ignore collaborator rows when the user is a robot identity', async () => {
      clsServiceMock.get.mockImplementation(((key: string) =>
        key === 'user.id' ? AUTOMATION_ROBOT_ID : undefined) as any);
      prismaServiceMock.collaborator.findMany.mockResolvedValue([
        { roleName: Role.Owner, principalId: AUTOMATION_ROBOT_ID } as any,
      ]);
      const result = await service['getRoleByBaseId']('base-id');
      expect(result).toBeNull();
    });
  });

  describe('getPermissionsByResourceId', () => {
    it('should return permissions for a space resource', async () => {
      const resourceId = 'spcxxxxxxxx';
      vi.spyOn(service as any, 'getPermissionBySpaceId').mockImplementation(noop);
      await service.getPermissionsByResourceId(resourceId);
      expect(service['getPermissionBySpaceId']).toHaveBeenCalledWith(resourceId, undefined);
    });

    it('should return permissions for a base resource', async () => {
      const resourceId = 'bsexxxxxx';
      vi.spyOn(service as any, 'getPermissionByBaseId').mockImplementation(noop);
      await service.getPermissionsByResourceId(resourceId);
      expect(service['getPermissionByBaseId']).toHaveBeenCalledWith(resourceId, undefined);
    });

    it('should return permissions for a table resource', async () => {
      const resourceId = 'tblxxxxxxx';
      vi.spyOn(service as any, 'getPermissionByTableId').mockImplementation(noop);
      await service.getPermissionsByResourceId(resourceId);
      expect(service['getPermissionByTableId']).toHaveBeenCalledWith(resourceId, undefined);
    });

    it('should throw an error if resource is not found', async () => {
      const resourceId = 'invalid-id';
      const error = await getError(
        async () => await service.getPermissionsByResourceId(resourceId)
      );
      expect(error).toBeDefined();
      expect(error?.status).toBe(403);
      expect(error?.message).toBe('Request path is not valid');
    });
  });

  describe('getUpperIdByBaseId', () => {
    it('should return spaceId when valid baseId is provided', async () => {
      const baseId = 'bsexxxxxxxx';
      const spaceId = 'spcxxxxxxxxx';

      prismaServiceMock.base.findUnique.mockResolvedValueOnce({ spaceId } as any);
      const result = await service['getUpperIdByBaseId'](baseId);
      expect(result).toEqual({ spaceId });
    });

    it('should throw NotFoundException when invalid baseId is provided', async () => {
      const baseId = 'bsexxxxxxxx';

      prismaServiceMock.base.findUnique.mockResolvedValueOnce(null);

      const error = await getError(async () => await service['getUpperIdByBaseId'](baseId));
      expect(error).toBeDefined();
      expect(error?.status).toBe(404);
      expect(error?.message).toBe('Project not found');
    });
  });

  describe('isBaseIdAllowedForResource', () => {
    it('should return true when baseId is allowed for the resource', async () => {
      const baseId = 'bsexxxxxxxxx';
      const spaceIds = ['spcxxxxxxx'];
      const baseIds = ['bsexxxxxxxxx'];

      vi.spyOn(service as any, 'getUpperIdByBaseId').mockResolvedValueOnce({
        spaceId: 'spcxxxxxxx',
      });

      const result = await service['isBaseIdAllowedForResource'](baseId, spaceIds, baseIds);

      expect(result).toBe(true);
    });

    it('should return false when baseId is not allowed for the resource', async () => {
      const baseId = 'invalidBaseId';
      const spaceIds = ['spcxxxxxxx'];
      const baseIds = ['bsexxxxxxxxx'];

      vi.spyOn(service as any, 'getUpperIdByBaseId').mockResolvedValueOnce({
        spaceId: 'spc222222222',
      });

      const result = await service['isBaseIdAllowedForResource'](baseId, spaceIds, baseIds);

      expect(result).toBe(false);
    });

    it('should return true when baseIds is undefined', async () => {
      const baseId = 'bsexxxxxxxxx';
      const spaceIds = ['spcxxxxxxx'];
      const baseIds = undefined;

      vi.spyOn(service as any, 'getUpperIdByBaseId').mockResolvedValueOnce({
        spaceId: 'spcxxxxxxx',
      });

      const result = await service['isBaseIdAllowedForResource'](baseId, spaceIds, baseIds);

      expect(result).toBe(true);
    });
  });

  describe('isTableIdAllowedForResource', () => {
    it('should return true when tableId is allowed for the resource', async () => {
      const tableId = 'validTableId';
      const spaceIds = ['spcxxxxxx'];
      const baseIds = ['bsexxxxxx'];

      vi.spyOn(service as any, 'getUpperIdByTableId').mockResolvedValueOnce({
        spaceId: 'spcxxxxxx',
        baseId: 'bsexxxxxx',
      });

      const result = await service['isTableIdAllowedForResource'](tableId, spaceIds, baseIds);

      expect(result).toBe(true);
    });

    it('should return false when tableId is not allowed for the resource', async () => {
      const tableId = 'invalidTableId';
      const spaceIds = ['spcxxxxxx'];
      const baseIds = ['bsexxxxxx'];

      vi.spyOn(service as any, 'getUpperIdByTableId').mockResolvedValueOnce({
        spaceId: 'spc11111111',
        baseId: 'bse1111111',
      });

      const result = await service['isTableIdAllowedForResource'](tableId, spaceIds, baseIds);

      expect(result).toBe(false);
    });

    it('should return true when baseIds is undefined', async () => {
      const tableId = 'tblxxxxxx';
      const spaceIds = ['spcxxxxxx'];
      const baseIds = undefined;

      vi.spyOn(service as any, 'getUpperIdByTableId').mockResolvedValueOnce({
        spaceId: 'spcxxxxxx',
        baseId: 'bsexxxxxxx',
      });

      const result = await service['isTableIdAllowedForResource'](tableId, spaceIds, baseIds);

      expect(result).toBe(true);
    });
  });

  describe('getPermissionsByAccessToken', () => {
    it('should return scopes when resourceId is a valid spaceId and allowed', async () => {
      const resourceId = 'spcxxxxxxx';
      const accessTokenId = 'validAccessTokenId';
      const scopes: Action[] = ['table|create', 'table|update'];
      const spaceIds = ['spcxxxxxxx'];

      vi.spyOn(service, 'getAccessToken').mockResolvedValueOnce({
        scopes,
        spaceIds,
        baseIds: undefined,
        hasFullAccess: undefined,
      });

      const result = await service.getPermissionsByAccessToken(resourceId, accessTokenId);

      expect(result).toEqual(scopes);
    });

    it('should throw ForbiddenException when resourceId is a valid spaceId but not allowed', async () => {
      const resourceId = 'invalidSpaceId';
      const accessTokenId = 'validAccessTokenId';
      const spaceIds = ['spcxxxxxxx'];

      vi.spyOn(service, 'getAccessToken').mockResolvedValueOnce({
        scopes: ['table|update'],
        spaceIds,
        baseIds: undefined,
        hasFullAccess: undefined,
      });

      const error = await getError(
        async () => await service.getPermissionsByAccessToken(resourceId, accessTokenId)
      );
      expect(error).toBeDefined();
      expect(error?.status).toBe(403);
    });

    it('should throw ForbiddenException when resourceId is a valid baseId but not allowed', async () => {
      const resourceId = 'bsexxxxxx';
      const accessTokenId = 'validAccessTokenId';
      const baseIds = ['bsexxxxxx1'];

      vi.spyOn(service, 'getAccessToken').mockResolvedValueOnce({
        scopes: ['table|read'],
        baseIds,
        spaceIds: undefined,
        hasFullAccess: undefined,
      });

      vi.spyOn(service as any, 'isBaseIdAllowedForResource').mockResolvedValueOnce(false);

      const error = await getError(
        async () => await service.getPermissionsByAccessToken(resourceId, accessTokenId)
      );
      expect(error).toBeDefined();
      expect(error?.status).toBe(403);
    });

    it('should throw ForbiddenException when resourceId is a valid tableId but not allowed', async () => {
      const resourceId = 'invalidTableId';
      const accessTokenId = 'validAccessTokenId';
      const baseIds = ['bsexxxxxx'];
      const spaceIds = ['spcxxxxxxx'];

      vi.spyOn(service, 'getAccessToken').mockResolvedValueOnce({
        scopes: ['table|read'],
        spaceIds,
        baseIds,
        hasFullAccess: undefined,
      });

      const error = await getError(
        async () => await service.getPermissionsByAccessToken(resourceId, accessTokenId)
      );
      expect(error).toBeDefined();
      expect(error?.status).toBe(403);
    });
  });

  describe('getAccessToken (GHSA-c57x: OAuth scope escalation)', () => {
    it('does NOT add base|read_all to an OAuth token that did not consent to it', async () => {
      // A user consented only to table|read for this OAuth client.
      prismaServiceMock.accessToken.findFirstOrThrow.mockResolvedValue({
        scopes: JSON.stringify(['table|read'] satisfies Action[]),
        spaceIds: null,
        baseIds: null,
        clientId: 'cltoauthclient00', // IdPrefix.OAuthClient
        userId: 'usrxxxxxxxx',
        hasFullAccess: null,
      } as any);
      // OAuth collaborator resolution goes through txClient().collaborator.
      prismaServiceMock.txClient.mockReturnValue(prismaServiceMock as any);
      prismaServiceMock.collaborator.findMany.mockResolvedValue([]);

      const result = await service.getAccessToken('actxxxxxxxx');

      // The token must not gain read access it was never approved for.
      expect(result.scopes).not.toContain('base|read_all');
      expect(result.scopes).toEqual(['table|read']);
      expect(result.clientId).toBe('cltoauthclient00');
    });

    it('preserves base|read_all for an OAuth token that DID consent to it', async () => {
      prismaServiceMock.accessToken.findFirstOrThrow.mockResolvedValue({
        scopes: JSON.stringify(['table|read', 'base|read_all'] satisfies Action[]),
        spaceIds: null,
        baseIds: null,
        clientId: 'cltoauthclient00',
        userId: 'usrxxxxxxxx',
        hasFullAccess: null,
      } as any);
      prismaServiceMock.txClient.mockReturnValue(prismaServiceMock as any);
      prismaServiceMock.collaborator.findMany.mockResolvedValue([]);

      const result = await service.getAccessToken('actxxxxxxxx');

      expect(result.scopes).toContain('base|read_all');
    });

    it('does NOT add base|read_all to a regular (non-OAuth) PAT', async () => {
      prismaServiceMock.accessToken.findFirstOrThrow.mockResolvedValue({
        scopes: JSON.stringify(['table|read'] satisfies Action[]),
        spaceIds: null,
        baseIds: null,
        clientId: null, // regular personal access token
        userId: 'usrxxxxxxxx',
        hasFullAccess: null,
      } as any);

      const result = await service.getAccessToken('actxxxxxxxx');

      expect(result.scopes).not.toContain('base|read_all');
      expect(result.scopes).toEqual(['table|read']);
    });
  });

  describe('getPermissionByBaseId with an internal token', () => {
    const snapshotBase = { id: 'bseSnapshot', spaceId: 'spcTemplates', deletedTime: null };

    beforeEach(() => {
      prismaServiceMock.txClient.mockReturnValue(prismaServiceMock);
      clsServiceMock.get.mockImplementation(((key: string) =>
        key === 'tempAuthBaseId' ? snapshotBase.id : undefined) as any);
      prismaServiceMock.base.findUnique.mockResolvedValue(snapshotBase as any);
    });

    const lookups = (published: unknown, pending: unknown) => {
      prismaServiceMock.template.findMany.mockResolvedValue((published ? [published] : []) as any);
      prismaServiceMock.template.findFirst.mockImplementation((({ where }: any) =>
        Promise.resolve(where.review ? pending : null)) as any);
    };

    it('keeps a snapshot under review read-only', async () => {
      prismaServiceMock.space.findUnique.mockResolvedValue({ isTemplate: true } as any);
      lookups(null, { id: 'tplPending', review: { status: 'review' } });

      const permissions = await service['getPermissionByBaseId'](snapshotBase.id);

      expect(permissions).toEqual(TemplatePermissions);
      expect(clsServiceMock.set).toHaveBeenCalledWith('template', {
        id: 'tplPending',
        baseId: snapshotBase.id,
      });
    });

    it('still gives an app in an ordinary project its owner permissions', async () => {
      prismaServiceMock.space.findUnique.mockResolvedValue({ isTemplate: false } as any);
      lookups(null, null);

      const permissions = await service['getPermissionByBaseId'](snapshotBase.id);

      expect(permissions).toEqual(getPermissions(Role.Owner));
      expect(prismaServiceMock.template.findMany).toHaveBeenCalledTimes(1);
      expect(prismaServiceMock.template.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getTemplatePermissions for a submission under review', () => {
    const lookups = (pending: unknown) => {
      prismaServiceMock.template.findMany.mockResolvedValue([]);
      prismaServiceMock.template.findFirst.mockImplementation((({ where }: any) =>
        Promise.resolve(where.review ? pending : null)) as any);
    };

    beforeEach(() => {
      prismaServiceMock.txClient.mockReturnValue(prismaServiceMock);
      // anyone following a shared link: no session, not an admin
      clsServiceMock.get.mockReturnValue(undefined as any);
    });

    it('opens it read-only to anyone, so its link can be shared before the review', async () => {
      lookups({ id: 'tplShared', review: { status: 'review', snapshotBaseId: 'bseShared' } });

      const permissions = await service.getTemplatePermissions('bseShared');

      expect(permissions).toEqual(TemplatePermissions);
      expect(clsServiceMock.set).toHaveBeenCalledWith('template', {
        id: 'tplShared',
        baseId: 'bseShared',
      });
    });

    it("keeps a live template's newer version with the reviewers", async () => {
      lookups({
        id: 'tplLive',
        isPublished: true,
        review: { status: 'review', snapshotBaseId: 'bseNewVersion' },
      });

      await expect(service.getTemplatePermissions('bseNewVersion')).rejects.toThrow(
        'Template access denied'
      );
    });

    it('keeps the pending version of a template taken offline with the reviewers', async () => {
      lookups({
        id: 'tplOffline',
        isPublished: false,
        snapshot: JSON.stringify({ baseId: 'bseWasLive' }),
        review: { status: 'review', snapshotBaseId: 'bseOfflinePending' },
      });

      await expect(service.getTemplatePermissions('bseOfflinePending')).rejects.toThrow(
        'Template access denied'
      );
    });

    it('still opens that newer version to a reviewer', async () => {
      clsServiceMock.get.mockImplementation(((key: string) =>
        key === 'user.isAdmin' ? true : undefined) as any);
      lookups({
        id: 'tplLive',
        isPublished: true,
        review: { status: 'review', snapshotBaseId: 'bseNewVersionAdmin' },
      });

      await expect(service.getTemplatePermissions('bseNewVersionAdmin')).resolves.toEqual(
        TemplatePermissions
      );
    });

    it.each(['rejected', 'withdrawn'])('keeps a %s submission closed', async (status) => {
      lookups({ id: 'tplGone', review: { status, snapshotBaseId: `bseGone${status}` } });

      await expect(service.getTemplatePermissions(`bseGone${status}`)).rejects.toThrow(
        'Template access denied'
      );
    });
  });

  describe('getTemplatePermissions for a published snapshot', () => {
    const published = (snapshot: Record<string, unknown>) => {
      prismaServiceMock.template.findMany.mockResolvedValue([
        { id: 'tplPublished', snapshot: JSON.stringify(snapshot) },
      ] as any);
      prismaServiceMock.template.findFirst.mockResolvedValue(null);
    };

    beforeEach(() => {
      prismaServiceMock.txClient.mockReturnValue(prismaServiceMock);
      clsServiceMock.get.mockReturnValue(undefined as any);
    });

    it('opens the snapshot base read-only', async () => {
      published({ baseId: 'bseSnapshotOwn', name: 'Snapshot' });

      await expect(service.getTemplatePermissions('bseSnapshotOwn')).resolves.toEqual(
        TemplatePermissions
      );
      expect(clsServiceMock.set).toHaveBeenCalledWith('template', {
        id: 'tplPublished',
        baseId: 'bseSnapshotOwn',
      });
    });

    it('does not open a base whose id the snapshot only mentions', async () => {
      published({ baseId: 'bseSnapshotOther', name: 'bseNamedOnly' });

      await expect(service.getTemplatePermissions('bseNamedOnly')).rejects.toThrow(
        'Template access denied'
      );
      expect(clsServiceMock.set).not.toHaveBeenCalledWith('template', expect.anything());
    });
  });

  describe('getPermissions', () => {
    it('should return permissions for a user', async () => {
      const resourceId = 'bsexxxxxx';
      vi.spyOn(service, 'getPermissionsByResourceId').mockResolvedValue(
        getPermissions(Role.Editor)
      );
      const result = await service.getPermissions(resourceId);
      expect(result.includes('view|create')).toEqual(true);
      expect(result.includes('space|create')).toEqual(false);
    });

    it('should return permissions for access token', async () => {
      const resourceId = 'bsexxxxxx';
      vi.spyOn(service, 'getPermissionsByResourceId').mockResolvedValue(
        getPermissions(Role.Editor)
      );
      vi.spyOn(service, 'getPermissionsByAccessToken').mockResolvedValue([
        'view|create',
        'space|delete',
      ]);
      const result = await service.getPermissions(resourceId, 'access-token-id');
      expect(result.includes('view|create')).toEqual(true);
      expect(result.includes('space|delete')).toEqual(false);
      expect(result.includes('view|delete')).toEqual(false);
    });
  });

  describe('validPermissions', () => {
    it('should return true if user has all required permissions', async () => {
      const permissions = getPermissions(Role.Creator);
      vi.spyOn(service, 'getPermissions').mockResolvedValue(permissions);
      const resourceId = 'bsexxxxxx';
      const result = await service.validPermissions(resourceId, ['base|create']);
      expect(result).toEqual(permissions);
    });

    it('should throw an error if user does not have all required permissions', async () => {
      vi.spyOn(service, 'getPermissions').mockResolvedValue(getPermissions(Role.Editor));
      const resourceId = 'bsexxxxxx';
      await expect(service.validPermissions(resourceId, ['space|create'])).rejects.toThrow(
        `not allowed to operate space|create on ${resourceId}`
      );
    });
  });

  describe('a node share', () => {
    const baseId = 'bsexxxxxxxxxxxx';
    // The share is made for a folder holding one workflow; a second workflow sits outside it.
    const nodes = [
      { id: 'bnoFolder', parentId: null, resourceType: 'folder', resourceId: 'bnoFolder' },
      { id: 'bnoFlowIn', parentId: 'bnoFolder', resourceType: 'workflow', resourceId: 'wflIn' },
      { id: 'bnoFlowOut', parentId: null, resourceType: 'workflow', resourceId: 'wflOut' },
    ];

    it('opens a workflow in its subtree and no other', async () => {
      prismaServiceMock.baseNode.findMany.mockResolvedValue(nodes as any);
      prismaServiceMock.baseShare.findFirst.mockResolvedValue({
        baseId,
        nodeId: 'bnoFolder',
        allowEdit: false,
        allowCopy: false,
      } as any);
      prismaServiceMock.baseNode.findFirst.mockImplementation(
        (async (args: any) =>
          nodes.find((node) => node.resourceId === args.where.resourceId) ?? null) as any
      );

      await expect(service.getBaseSharePermissions('shrxxx', 'wflIn')).resolves.toContain(
        'automation|read'
      );
      await expect(service.getBaseSharePermissions('shrxxx', 'wflOut')).rejects.toThrow(
        'Resource wflOut is not accessible via share shrxxx'
      );
    });
  });

  describe('a share with a password', () => {
    const shareId = 'shrxxxxxxxxxxxx';
    const password = 'stored password';
    // what the share's password page hands out, as the cookie named after the share
    const tokenOf = (id: string) =>
      service['jwtService'].signAsync({ shareId: id, pwHash: hashSharePassword(id, password) });

    it('is presented by the cookie its password page set, and by nothing else', async () => {
      prismaServiceMock.baseShare.findFirst.mockResolvedValue({ password } as any);
      const presented = (cookieHeader?: string) =>
        service.baseSharePasswordPresented(shareId, cookieHeader);

      await expect(presented(`theme=dark; ${shareId}=${await tokenOf(shareId)}`)).resolves.toBe(
        true
      );
      await expect(presented()).resolves.toBe(false);
      await expect(presented('theme=dark')).resolves.toBe(false);
      await expect(presented(`${shareId}=not-a-token`)).resolves.toBe(false);
      // a token another share handed out, sent under this share's name
      await expect(presented(`${shareId}=${await tokenOf('shrOther')}`)).resolves.toBe(false);
    });

    it('asks nothing of a share without one', async () => {
      prismaServiceMock.baseShare.findFirst.mockResolvedValue({ password: null } as any);

      await expect(service.baseSharePasswordPresented(shareId)).resolves.toBe(true);
    });

    it('holds a shared view to the same', async () => {
      const view = { id: 'viwxxx', tableId: 'tblxxx', type: 'grid' };
      prismaServiceMock.view.findFirst.mockResolvedValue({
        ...view,
        shareMeta: JSON.stringify({ password }),
      } as any);

      await expect(service.shareViewPasswordPresented(shareId)).resolves.toBe(false);
      await expect(
        service.shareViewPasswordPresented(shareId, `${shareId}=${await tokenOf(shareId)}`)
      ).resolves.toBe(true);

      prismaServiceMock.view.findFirst.mockResolvedValue({ ...view, shareMeta: null } as any);
      await expect(service.shareViewPasswordPresented(shareId)).resolves.toBe(true);
    });
  });
});
