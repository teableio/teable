/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
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

  const shareId = 'shareId';
  const mockUser = { id: 'usr1', name: 'John', email: 'john@example.com' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareDbModule],
    }).compile();

    shareDbPermissionService = module.get<ShareDbPermissionService>(ShareDbPermissionService);
    wsAuthService = module.get<WsAuthService>(WsAuthService);
    clsService = module.get<ClsService<IClsStore>>(ClsService);
  });

  describe('clsRunWith', () => {
    it('should run callback with cls context', async () => {
      // mock a context object with agent and custom properties
      const context = mockDeep<IAuthMiddleContext>({
        agent: { custom: { user: mockUser, isBackend: false } },
      });
      // mock a callback function
      const callback = vi.fn();
      // spy on clsService.set and get methods
      const setSpy = vi.spyOn(clsService, 'set');
      const getSpy = vi.spyOn(clsService, 'get');
      // call the clsRunWith method with the context and callback
      await shareDbPermissionService['clsRunWith'](context, callback);
      // expect the callback to be called once
      expect(callback).toHaveBeenCalledTimes(1);
      // expect the clsService.set to be called with 'user' and the user object
      expect(setSpy).toHaveBeenCalledWith('user', context.agent.custom.user);
      // expect the clsService.set to be called with 'user' and the shareId
      expect(setSpy).toHaveBeenCalledWith('shareViewId', context.agent.custom.shareId);
      // expect the clsService.get to return the user object
      expect(getSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('authMiddleware', () => {
    it('should call clsRunWith and set user in the CLS context if authentication is successful', async () => {
      const context = mockDeep<IAuthMiddleContext>({
        agent: {
          custom: { cookie: 'xxxx', sessionId: 'xxxx', isBackend: false, shareId: undefined },
        },
      });

      const callback = vi.fn();

      vi.spyOn(wsAuthService, 'checkSession').mockResolvedValue(mockUser);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(shareDbPermissionService as any, 'clsRunWith').mockImplementation(() => ({}));

      await shareDbPermissionService.authMiddleware(context, callback);

      expect(shareDbPermissionService['clsRunWith']).toHaveBeenCalledWith(context, callback);
      expect(wsAuthService.checkSession).toHaveBeenCalledWith('xxxx');
    });

    it('should call the callback without error if the context is from the backend', async () => {
      const context = mockDeep<IAuthMiddleContext>({
        agent: { custom: { isBackend: true } },
      });
      const callback = vi.fn();

      await shareDbPermissionService.authMiddleware(context, callback);

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith();
    });

    it('should call the callback with an error if authentication fails', async () => {
      const context = mockDeep<IAuthMiddleContext>({
        agent: { custom: { isBackend: false, cookie: 'xxx', shareId: undefined } },
      });

      const callback = vi.fn();

      const checkCookieMock = vi
        .spyOn(wsAuthService, 'checkSession')
        .mockRejectedValue(new Error('Authentication failed'));

      await shareDbPermissionService.authMiddleware(context, callback);

      expect(checkCookieMock).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(new Error('Authentication failed'));
    });

    it('should call the callback with share context', async () => {
      const context = mockDeep<IAuthMiddleContext>({
        agent: { custom: { cookie: 'xxxx', isBackend: false, shareId } },
      });

      const callback = vi.fn();

      vi.spyOn(wsAuthService, 'checkShareCookie').mockImplementation(() => ({}) as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(shareDbPermissionService as any, 'clsRunWith').mockImplementation(() => ({}) as any);

      await shareDbPermissionService.authMiddleware(context, callback);

      expect(shareDbPermissionService['clsRunWith']).toHaveBeenCalledWith(context, callback);
      expect(wsAuthService.checkShareCookie).toHaveBeenCalledWith(shareId, 'xxxx');
    });
  });
});
