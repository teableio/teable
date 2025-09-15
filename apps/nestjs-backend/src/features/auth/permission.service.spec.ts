/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Action } from '@teable/core';
import { Role, getPermissions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { noop } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { DeepMockProxy } from 'vitest-mock-extended';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from './permission.service';

describe('PermissionService', () => {
  let service: PermissionService;
  let prismaServiceMock: DeepMockProxy<PrismaService>;
  let clsServiceMock: DeepMockProxy<ClsService<IClsStore>>;

  beforeEach(async () => {
    prismaServiceMock = mockDeep<PrismaService>();
    clsServiceMock = mockDeep<ClsService<IClsStore>>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule],
      providers: [PermissionService, PrismaService, ClsService],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaServiceMock)
      .overrideProvider(ClsService)
      .useValue(clsServiceMock)
      .compile();

    service = module.get<PermissionService>(PermissionService);
  });

  afterEach(() => {
    mockReset(prismaServiceMock);
    mockReset(clsServiceMock);
  });

  describe('getRoleBySpaceId', () => {
    it('should return a SpaceRole', async () => {
      const spaceId = 'space-id';
      const roleName = 'space-role';
      prismaServiceMock.collaborator.findMany.mockResolvedValue([{ roleName } as any]);
      prismaServiceMock.space.findFirst.mockResolvedValue({ deletedTime: null } as any);
      const result = await service['getRoleBySpaceId'](spaceId);
      expect(result).toBe(roleName);
    });

    it('should throw a ForbiddenException if collaborator is not found', async () => {
      const spaceId = 'space-id';
      prismaServiceMock.collaborator.findMany.mockResolvedValue([]);
      prismaServiceMock.space.findFirst.mockResolvedValue({ deletedTime: null } as any);
      const res = await service['getRoleBySpaceId'](spaceId);
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
      const baseId = 'base-id';
      prismaServiceMock.collaborator.findMany.mockResolvedValue([]);
      const result = await service['getRoleByBaseId'](baseId);
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
      await expect(service.getPermissionsByResourceId(resourceId)).rejects.toThrowError(
        new ForbiddenException('request path is not valid')
      );
    });
  });

  describe('getUpperIdByBaseId', () => {
    it('should return spaceId when valid baseId is provided', async () => {
      const baseId = 'bsexxxxxxxx';
      const spaceId = 'spcxxxxxxxxx';

      prismaServiceMock.base.findFirst.mockResolvedValueOnce({ spaceId } as any);
      const result = await service['getUpperIdByBaseId'](baseId);
      expect(result).toEqual({ spaceId });
    });

    it('should throw NotFoundException when invalid baseId is provided', async () => {
      const baseId = 'bsexxxxxxxx';

      prismaServiceMock.base.findFirst.mockResolvedValueOnce(null);

      await expect(service['getUpperIdByBaseId'](baseId)).rejects.toThrowError(NotFoundException);
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

      await expect(
        service.getPermissionsByAccessToken(resourceId, accessTokenId)
      ).rejects.toThrowError(ForbiddenException);
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

      await expect(
        service.getPermissionsByAccessToken(resourceId, accessTokenId)
      ).rejects.toThrowError(ForbiddenException);
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
      });

      await expect(
        service.getPermissionsByAccessToken(resourceId, accessTokenId)
      ).rejects.toThrowError(ForbiddenException);
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
      await expect(service.validPermissions(resourceId, ['space|create'])).rejects.toThrowError(
        new ForbiddenException(`not allowed to operate space|create on ${resourceId}`)
      );
    });
  });
});
