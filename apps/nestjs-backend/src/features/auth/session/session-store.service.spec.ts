/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { CacheService } from '../../../cache/cache.service';
import type { IAuthConfig } from '../../../configs/auth.config';
import { AuthConfig } from '../../../configs/auth.config';
import { GlobalModule } from '../../../global/global.module';
import type { ISessionData } from '../../../types/session';
import { SessionStoreService } from './session-store.service';
import { SessionModule } from './session.module';

describe('SessionStoreService', () => {
  let sessionStoreService: SessionStoreService;
  const cacheService = mockDeep<CacheService>();
  const authConfig = mockDeep<IAuthConfig>({
    session: { expiresIn: '1d' },
  });
  const sid = 'session-id';
  const sessionData = { passport: { user: { id: 'user-id' } } } as ISessionData;
  const callbackMock = vitest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, SessionModule],
    })
      .overrideProvider(SessionStoreService)
      .useValue(sessionStoreService)
      .overrideProvider(CacheService)
      .useValue(cacheService)
      .overrideProvider(AuthConfig)
      .useValue(authConfig)
      .compile();

    sessionStoreService = module.get<SessionStoreService>(SessionStoreService);
  });

  afterEach(() => {
    vitest.resetAllMocks();
    mockReset(cacheService);
    mockReset(authConfig);
    callbackMock.mockReset();
  });

  it('should be defined', () => {
    expect(sessionStoreService).toBeDefined();
  });

  describe('setCache', () => {
    it('should set cache correctly', async () => {
      cacheService.get.mockResolvedValue({ 'session-id': 1234567890 });

      await sessionStoreService['setCache'](sid, sessionData);

      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-user:user-id`);
      expect(cacheService.set).toHaveBeenCalledWith(
        `auth:session-user:user-id`,
        {
          'session-id': Math.floor(Date.now() / 1000) + sessionStoreService['userSessionExpire'],
        },
        expect.any(Number)
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        `auth:session-store:${sid}`,
        sessionData,
        expect.any(Number)
      );
    });

    it('should set cache correctly when userSessions is undefined', async () => {
      cacheService.get.mockResolvedValue(undefined);

      await sessionStoreService['setCache'](sid, sessionData);

      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-user:user-id`);
      expect(cacheService.set).toHaveBeenCalledWith(
        `auth:session-user:user-id`,
        {
          'session-id': Math.floor(Date.now() / 1000) + sessionStoreService['userSessionExpire'],
        },
        expect.any(Number)
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        `auth:session-store:${sid}`,
        sessionData,
        expect.any(Number)
      );
    });

    it('should delete user session correctly when session is expired', async () => {
      const userSessions = {
        'session-id': 1234567890,
        'session-id-2': 1,
        'session-id-3':
          Math.floor(Date.now() / 1000) + sessionStoreService['userSessionExpire'] + 1000,
      };
      cacheService.get.mockResolvedValue(userSessions);

      await sessionStoreService['setCache'](sid, sessionData);

      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-user:user-id`);
      expect(cacheService.set).toHaveBeenCalledWith(
        `auth:session-user:user-id`,
        {
          'session-id': Math.floor(Date.now() / 1000) + sessionStoreService['userSessionExpire'],
          'session-id-3': userSessions['session-id-3'],
        },
        expect.any(Number)
      );
      expect(cacheService.set).toHaveBeenCalledWith(
        `auth:session-store:${sid}`,
        sessionData,
        expect.any(Number)
      );
    });
  });

  describe('getCache', () => {
    it('should return null if expire flag is set', async () => {
      // Mock the necessary cacheService methods
      cacheService.get.mockResolvedValueOnce(true);

      const result = await sessionStoreService['getCache'](sid);

      // Verify that cacheService.get was called with the expected parameter
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-expire:${sid}`);
      // Verify that the result is null when the expire flag is set
      expect(result).toBeNull();
    });

    it('should return null if session is not found', async () => {
      // Mock the necessary cacheService methods
      cacheService.get.mockResolvedValueOnce(undefined);
      cacheService.get.mockResolvedValueOnce(undefined);

      const result = await sessionStoreService['getCache'](sid);

      // Verify that cacheService.get was called with the expected parameters
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-expire:${sid}`);
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      // Verify that the result is null when session is not found
      expect(result).toBeNull();
    });

    it('should return undefined and delete session if user session is not found', async () => {
      // Mock the necessary cacheService methods
      cacheService.get.mockResolvedValueOnce(undefined);
      cacheService.get.mockResolvedValueOnce(sessionData);
      cacheService.get.mockResolvedValueOnce(undefined);
      cacheService.del.mockResolvedValueOnce();

      const result = await sessionStoreService['getCache'](sid);

      // Verify that cacheService.get and cacheService.del were called with the expected parameters
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-expire:${sid}`);
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-user:user-id`);
      expect(cacheService.del).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      // Verify that the result is null and session is deleted when user session is not found
      expect(result).toBeNull();
    });

    it('should return undefined and delete session if user session is expired', async () => {
      // Mock the necessary cacheService methods
      const nowSec = Math.floor(Date.now() / 1000);
      cacheService.get.mockResolvedValueOnce(false);
      cacheService.get.mockResolvedValueOnce(sessionData);
      cacheService.get.mockResolvedValueOnce({ [sid]: nowSec - 1, 'session-id-x': nowSec + 22 }); // Expired user session
      cacheService.del.mockResolvedValueOnce();
      cacheService.del.mockResolvedValueOnce();
      cacheService.set.mockResolvedValueOnce();

      const result = await sessionStoreService['getCache'](sid);

      // Verify that cacheService.get, cacheService.del, and cacheService.set were called with the expected parameters
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-expire:${sid}`);
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-user:user-id`);
      expect(cacheService.del).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      expect(cacheService.del).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      cacheService.del.mockResolvedValueOnce();

      expect(cacheService.set).toHaveBeenCalledWith(
        `auth:session-user:user-id`,
        { 'session-id-x': nowSec + 22 },
        expect.any(Number)
      );
      // Verify that the result is null and session is deleted when user session is expired
      expect(result).toBeNull();
    });

    it('should return session if user session is valid', async () => {
      // Mock the necessary cacheService methods
      const nowSec = Math.floor(Date.now() / 1000);
      cacheService.get.mockResolvedValueOnce(undefined);
      cacheService.get.mockResolvedValueOnce(sessionData);
      cacheService.get.mockResolvedValueOnce({ [sid]: nowSec + 1 }); // Valid user session

      const result = await sessionStoreService['getCache'](sid);

      // Verify that cacheService.get was called with the expected parameters
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-expire:${sid}`);
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-user:user-id`);
      // Verify that the result is the expected session when user session is valid
      expect(result).toEqual(sessionData);
    });
  });

  describe('get', () => {
    it('should get session and invoke callback with null error and session', async () => {
      // Mock the necessary methods
      vitest.spyOn(sessionStoreService as any, 'getCache').mockResolvedValueOnce(sessionData);

      await sessionStoreService.get(sid, callbackMock);

      // Verify that getCache method was called with the expected parameter
      expect(sessionStoreService['getCache']).toHaveBeenCalledWith(sid);
      // Verify that the callback was invoked with null error and the expected session
      expect(callbackMock).toHaveBeenCalledWith(null, sessionData);
    });

    it('should handle getCache error and invoke callback with error', async () => {
      const error = new Error('Get cache error');

      // Mock the necessary methods
      vitest.spyOn(sessionStoreService as any, 'getCache').mockRejectedValueOnce(error);

      await sessionStoreService.get(sid, callbackMock);

      // Verify that getCache method was called with the expected parameter
      expect(sessionStoreService['getCache']).toHaveBeenCalledWith(sid);
      // Verify that the callback was invoked with the expected error
      expect(callbackMock).toHaveBeenCalledWith(error);
    });
  });

  describe('set', () => {
    const callbackMock = vitest.fn();

    afterEach(() => {
      callbackMock.mockReset();
    });

    it('should set cache and call callback', async () => {
      // Mock the necessary methods
      vitest.spyOn(sessionStoreService as any, 'setCache').mockResolvedValueOnce(true);

      await sessionStoreService.set(sid, sessionData, callbackMock);

      // Verify that setCache method was called with the expected parameters
      expect(sessionStoreService['setCache']).toHaveBeenCalledWith(sid, sessionData);
      // Verify that the callback was called
      expect(callbackMock).toHaveBeenCalled();
    });

    it('should handle setCache error and call callback with error', async () => {
      const error = new Error('Set cache error');

      // Mock the necessary methods
      vitest.spyOn(sessionStoreService as any, 'setCache').mockRejectedValueOnce(error);

      await sessionStoreService.set(sid, sessionData, callbackMock);

      // Verify that setCache method was called with the expected parameters
      expect(sessionStoreService['setCache']).toHaveBeenCalledWith(sid, sessionData);
      // Verify that the callback was called with the error
      expect(callbackMock).toHaveBeenCalledWith(error);
    });
  });

  describe('destroy', () => {
    it('should delete session from cache and call callback', async () => {
      // Mock the necessary methods
      cacheService.del.mockResolvedValueOnce();

      await sessionStoreService.destroy(sid, callbackMock);

      // Verify that cacheService.del method was called with the expected parameter
      expect(cacheService.del).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      // Verify that the callback was called
      expect(callbackMock).toHaveBeenCalled();
    });

    it('should handle cacheService.del error and call callback with error', async () => {
      const error = new Error('Cache service del error');

      // Mock the necessary methods
      cacheService.del.mockRejectedValueOnce(error);

      await sessionStoreService.destroy(sid, callbackMock);

      // Verify that cacheService.del method was called with the expected parameter
      expect(cacheService.del).toHaveBeenCalledWith(`auth:session-store:${sid}`);
      // Verify that the callback was called with the error
      expect(callbackMock).toHaveBeenCalledWith(error);
    });
  });
  describe('touch', () => {
    it('should touch session, set it, and call callback', async () => {
      // Mock the necessary methods
      vitest.spyOn(sessionStoreService as any, 'getCache').mockResolvedValueOnce(sessionData);
      vitest.spyOn(sessionStoreService as any, 'setCache').mockResolvedValueOnce(null);

      await sessionStoreService.touch(sid, sessionData, callbackMock);

      // Verify that getCache and set methods were called with the expected parameters
      expect(sessionStoreService['getCache']).toHaveBeenCalledWith(sid);
      expect(sessionStoreService['setCache']).toHaveBeenCalledWith(sid, sessionData);
      // Verify that the callback was called
      expect(callbackMock).toHaveBeenCalled();
    });

    it('should handle getCache undefined and call callback with error', async () => {
      const error = new Error('Session not found');

      // Mock the necessary methods
      vitest.spyOn(sessionStoreService as any, 'getCache').mockResolvedValueOnce(undefined);

      await sessionStoreService.touch(sid, sessionData, callbackMock);

      // Verify that getCache method was called with the expected parameter
      expect(sessionStoreService['getCache']).toHaveBeenCalledWith(sid);
      // Verify that the callback was called with the error
      expect(callbackMock).toHaveBeenCalledWith(error);
    });

    it('should handle getCache error and call callback with error', async () => {
      const error = new Error('Get cache error');

      // Mock the necessary methods
      vitest.spyOn(sessionStoreService as any, 'getCache').mockRejectedValueOnce(error);

      await sessionStoreService.touch(sid, sessionData, callbackMock);

      // Verify that getCache method was called with the expected parameter
      expect(sessionStoreService['getCache']).toHaveBeenCalledWith(sid);
      // Verify that the callback was called with the error
      expect(callbackMock).toHaveBeenCalledWith(error);
    });
  });

  describe('clearByUserId', () => {
    const userId = 'user-id';

    it('should clear user sessions and set expire flag', async () => {
      // Mock the necessary methods
      cacheService.get.mockResolvedValueOnce({ 'session-id': 123 });
      cacheService.set.mockResolvedValueOnce();
      cacheService.del.mockResolvedValueOnce();

      await sessionStoreService.clearByUserId(userId);

      // Verify that cacheService.get, set, and del methods were called with the expected parameters
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-user:${userId}`);
      expect(cacheService.set).toHaveBeenCalledWith(`auth:session-expire:session-id`, true, 60);
      expect(cacheService.del).toHaveBeenCalledWith(`auth:session-store:session-id`);
      expect(cacheService.del).toHaveBeenCalledWith(`auth:session-user:${userId}`);
    });

    it('should handle empty user sessions in clearByUserId method', async () => {
      // Mock the necessary methods
      cacheService.get.mockResolvedValueOnce(undefined);

      await sessionStoreService.clearByUserId(userId);

      // Verify that cacheService.get was called with the expected parameter
      expect(cacheService.get).toHaveBeenCalledWith(`auth:session-user:${userId}`);
    });
  });
});
