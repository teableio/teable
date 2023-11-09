/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ActionPrefix, IdPrefix } from '@teable-group/core';
import { mockDeep } from 'jest-mock-extended';
import { ClsService } from 'nestjs-cls';
import type ShareDBClass from 'sharedb';
import { PermissionService } from '../features/auth/permission.service';
import { GlobalModule } from '../global/global.module';
import type { IClsStore } from '../types/cls';
import type { IAuthMiddleContext } from './share-db-permission.service';
import { ShareDbPermissionService } from './share-db-permission.service';
import { ShareDbModule } from './share-db.module';
import { WsAuthService } from './ws-auth.service';

describe('ShareDBPermissionService', () => {
  let shareDbPermissionService: ShareDbPermissionService;
  let wsAuthService: WsAuthService;
  let clsService: ClsService<IClsStore>;
  let permissionService: PermissionService;

  const mockUser = { id: 'usr1', name: 'John', email: 'john@example.com' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareDbModule],
    }).compile();

    shareDbPermissionService = module.get<ShareDbPermissionService>(ShareDbPermissionService);
    wsAuthService = module.get<WsAuthService>(WsAuthService);
    clsService = module.get<ClsService<IClsStore>>(ClsService);
    permissionService = module.get<PermissionService>(PermissionService);
  });

  describe('clsRunWith', () => {
    it('should run callback with cls context', async () => {
      // mock a context object with agent and custom properties
      const context = mockDeep<IAuthMiddleContext>({
        agent: { custom: { user: mockUser, isBackend: false } },
      });
      // mock a callback function
      const callback = jest.fn();
      // spy on clsService.set and get methods
      const setSpy = jest.spyOn(clsService, 'set');
      const getSpy = jest.spyOn(clsService, 'get');
      // call the clsRunWith method with the context and callback
      await shareDbPermissionService['clsRunWith'](context, callback);
      // expect the callback to be called once
      expect(callback).toHaveBeenCalledTimes(1);
      // expect the clsService.set to be called with 'user' and the user object
      expect(setSpy).toHaveBeenCalledWith('user', context.agent.custom.user);
      // expect the clsService.get to return the user object
      expect(getSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('authMiddleware', () => {
    it('should call clsRunWith and set user in the CLS context if authentication is successful', async () => {
      const context = mockDeep<IAuthMiddleContext>({
        agent: { custom: { cookie: 'xxxx', isBackend: false } },
      });

      const callback = jest.fn();

      jest.spyOn(wsAuthService, 'checkCookie').mockResolvedValue(mockUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(shareDbPermissionService as any, 'clsRunWith').mockImplementation();

      await shareDbPermissionService.authMiddleware(context, callback);

      expect(shareDbPermissionService['clsRunWith']).toHaveBeenCalledWith(context, callback);
      expect(wsAuthService.checkCookie).toHaveBeenCalledWith('xxxx');
    });

    it('should call the callback without error if the context is from the backend', async () => {
      const context = mockDeep<IAuthMiddleContext>({
        agent: { custom: { isBackend: true } },
      });
      const callback = jest.fn();

      await shareDbPermissionService.authMiddleware(context, callback);

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith();
    });

    it('should call the callback with an error if authentication fails', async () => {
      const context = mockDeep<IAuthMiddleContext>({
        agent: { custom: { isBackend: false, cookie: 'xxx' } },
      });

      const callback = jest.fn();

      const checkCookieMock = jest
        .spyOn(wsAuthService, 'checkCookie')
        .mockRejectedValue(new Error('Authentication failed'));

      await shareDbPermissionService.authMiddleware(context, callback);

      expect(checkCookieMock).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(new Error('Authentication failed'));
    });
  });

  describe('checkApplyPermissionMiddleware', () => {
    const tableId = 'tbl1';
    const fieldId = 'fld1';
    const fieldUpdateNameOp = {
      create: undefined,
      del: undefined,
      op: [
        {
          p: ['name'],
          oi: 'name2',
          od: 'name1',
        },
      ],
    };
    it('should call runPermissionCheck with the correct parameters', async () => {
      const context = mockDeep<ShareDBClass.middleware.ApplyContext>({
        agent: { custom: { isBackend: false, user: mockUser } },
        id: fieldId,
        collection: `${IdPrefix.Field}_${tableId}`,
        op: fieldUpdateNameOp,
      });

      const callback = jest.fn();

      const runPermissionCheckMock = jest
        .spyOn(shareDbPermissionService as any, 'runPermissionCheck')
        .mockResolvedValue(undefined);

      await shareDbPermissionService.checkApplyPermissionMiddleware(context, callback);

      expect(runPermissionCheckMock).toHaveBeenCalledWith(
        `${IdPrefix.Field}_${tableId}`,
        `${ActionPrefix.Field}|update`
      );
      expect(callback).toHaveBeenCalled();
    });

    it('should call the callback with an error if runPermissionCheck returns an error', async () => {
      const context = mockDeep<ShareDBClass.middleware.ApplyContext>({
        agent: { custom: { isBackend: false, user: mockUser } },
        id: fieldId,
        collection: `${IdPrefix.Field}_${tableId}`,
        op: fieldUpdateNameOp,
      });

      const callback = jest.fn();

      const runPermissionCheckMock = jest
        .spyOn(shareDbPermissionService as any, 'runPermissionCheck')
        .mockRejectedValue('error');

      await shareDbPermissionService.checkApplyPermissionMiddleware(context, callback);

      expect(runPermissionCheckMock).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith('error');
    });

    it('action and prefixAction not is exist', async () => {
      const context = mockDeep<ShareDBClass.middleware.ApplyContext>({
        agent: { custom: { isBackend: false, user: mockUser } },
        id: fieldId,
        collection: `xxx_${tableId}`,
        op: fieldUpdateNameOp,
      });

      const callback = jest.fn();

      await shareDbPermissionService.checkApplyPermissionMiddleware(context, callback);

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith('unknown docType: xxx');
    });
  });

  describe('checkReadPermissionMiddleware', () => {
    const tableId = 'tbl1';

    it('should call runPermissionCheck with the correct parameters', async () => {
      const context = mockDeep<ShareDBClass.middleware.ReadSnapshotsContext>({
        collection: `${IdPrefix.Field}_${tableId}`,
        action: 'readSnapshots',
        agent: { custom: { isBackend: false, user: mockUser } },
      });

      const callback = jest.fn();

      const runPermissionCheckMock = jest
        .spyOn(shareDbPermissionService as any, 'runPermissionCheck')
        .mockResolvedValue(undefined);

      await shareDbPermissionService.checkReadPermissionMiddleware(context, callback);

      expect(runPermissionCheckMock).toHaveBeenCalledWith(
        `${IdPrefix.Field}_${tableId}`,
        `${ActionPrefix.Field}|read`
      );
      expect(callback).toHaveBeenCalled();
    });

    it('should call the callback with an error if runPermissionCheck returns an error', async () => {
      const context = mockDeep<ShareDBClass.middleware.ReadSnapshotsContext>({
        collection: `${IdPrefix.Field}_${tableId}`,
        action: 'readSnapshots',
        agent: { custom: { isBackend: false, user: mockUser } },
      });

      const callback = jest.fn();

      const runPermissionCheckMock = jest
        .spyOn(shareDbPermissionService as any, 'runPermissionCheck')
        .mockRejectedValue('error');

      await shareDbPermissionService.checkReadPermissionMiddleware(context, callback);

      expect(runPermissionCheckMock).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith('error');
    });

    it('prefixAction not is exist', async () => {
      const context = mockDeep<ShareDBClass.middleware.ApplyContext>({
        agent: { custom: { isBackend: false, user: mockUser } },
        collection: `xxx_${tableId}`,
        action: 'readSnapshots',
      });

      const callback = jest.fn();

      await shareDbPermissionService.checkApplyPermissionMiddleware(context, callback);

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith('unknown docType: xxx');
    });
  });

  describe('runPermissionCheck', () => {
    it('should call checkPermissionByBaseId if docType is IdPrefix.Table', async () => {
      const collection = `${IdPrefix.Table}_bse1`;
      const permissionAction = 'table|read';

      const checkPermissionByBaseIdMock = jest
        .spyOn(permissionService, 'checkPermissionByBaseId')
        .mockResolvedValue([]);

      await shareDbPermissionService['runPermissionCheck'](collection, permissionAction);

      expect(checkPermissionByBaseIdMock).toHaveBeenCalledWith('bse1', [permissionAction]);
    });

    it('should call checkPermissionByTableId if docType is not IdPrefix.View', async () => {
      const collection = `${IdPrefix.View}_tbl1`;
      const permissionAction = 'view|read';

      const checkPermissionByTableIdMock = jest
        .spyOn(permissionService, 'checkPermissionByTableId')
        .mockResolvedValue([]);

      await shareDbPermissionService['runPermissionCheck'](collection, permissionAction);

      expect(checkPermissionByTableIdMock).toHaveBeenCalledWith('tbl1', [permissionAction]);
    });

    it('should return the error if an exception is thrown', async () => {
      const collection = `${IdPrefix.Table}_bse1`;
      const permissionAction = 'table|read';

      const errorMessage = 'Permission denied';

      const checkPermissionByBaseIdMock = jest
        .spyOn(permissionService, 'checkPermissionByBaseId')
        .mockRejectedValue(new Error(errorMessage));

      const error = await shareDbPermissionService['runPermissionCheck'](
        collection,
        permissionAction
      );

      expect(checkPermissionByBaseIdMock).toHaveBeenCalledWith('bse1', [permissionAction]);
      expect(error).toEqual(new Error(errorMessage));
    });
  });
});
