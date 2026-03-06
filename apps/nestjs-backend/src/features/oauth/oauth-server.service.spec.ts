/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { Mock, MockInstance } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { CacheService } from '../../cache/cache.service';
import { CustomHttpException } from '../../custom.exception';
import { GlobalModule } from '../../global/global.module';
import { OAuthServerService } from './oauth-server.service';
import { OAuthModule } from './oauth.module';

describe('OAuthServerService', () => {
  let service: OAuthServerService;
  const prismaService = mockDeep<PrismaService>();
  const cacheService = mockDeep<CacheService>();
  const jwtService = mockDeep<JwtService>();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, OAuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .overrideProvider(CacheService)
      .useValue(cacheService)
      .overrideProvider(JwtService)
      .useValue(jwtService)
      .compile();

    service = module.get<OAuthServerService>(OAuthServerService);

    prismaService.txClient.mockImplementation(() => {
      return prismaService;
    });

    prismaService.$tx.mockImplementation(async (fn) => {
      return await fn(prismaService);
    });

    // Default: rate limit not exceeded
    cacheService.incr.mockResolvedValue(1);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('authorizeValidate', () => {
    let done: Mock;
    beforeEach(() => {
      done = vitest.fn();
      // // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vitest.spyOn(service as any, 'getOAuthApp').mockResolvedValueOnce({
        redirectUris: ['http://localhost/callback'],
        scopes: ['user|email_read'],
      });
    });

    afterEach(() => {
      done.mockReset();
      vitest.restoreAllMocks();
    });

    it('should pass with valid scopes and redirectUri', async () => {
      await service['authorizeValidate'](
        {
          clientID: 'clientId',
          redirectURI: 'http://localhost/callback',
          scope: ['user|email_read'],
          type: 'code',
          state: 'sample state',
          transactionID: 'transactionID',
        },
        done
      );
      expect(done).toHaveBeenCalledWith(
        null,
        {
          clientId: 'clientId',
          scopes: ['user|email_read'],
          redirectUri: 'http://localhost/callback',
        },
        'http://localhost/callback'
      );
    });

    it('should fail with invalid scopes', async () => {
      await service['authorizeValidate'](
        {
          clientID: 'clientId',
          redirectURI: 'http://localhost/callback',
          scope: ['table|read'],
          state: 'sample state',
          type: 'code',
          transactionID: 'transactionID',
        },
        done
      );
      expect(done).toHaveBeenCalledWith(new BadRequestException('Invalid scopes: table|read'));
    });

    it('should fail if no redirectUri configured', async () => {
      vitest.resetAllMocks();
      vitest.spyOn(service as any, 'getOAuthApp').mockResolvedValue({
        redirectUris: [],
        scopes: ['user|email_read'],
      });
      await service['authorizeValidate'](
        {
          clientID: 'clientId',
          redirectURI: 'http://localhost/callback',
          scope: ['user|email_read'],
          state: 'sample state',
          type: 'code',
          transactionID: 'transactionID',
        },
        done
      );
      expect(done).toHaveBeenCalledWith(new BadRequestException('Redirect uri not configured'));
    });

    it('should fail with invalid redirectUri', async () => {
      await service['authorizeValidate'](
        {
          clientID: 'clientId',
          redirectURI: 'http://invalid/callback',
          scope: ['user|email_read'],
          state: 'sample state',
          type: 'code',
          transactionID: 'transactionID',
        },
        done
      );

      expect(done).toHaveBeenCalledWith(new UnauthorizedException('Invalid redirectUri'));
    });

    it('should pass with default redirectUri if none is provided', async () => {
      await service['authorizeValidate'](
        {
          clientID: 'clientId',
          redirectURI: 'http://localhost/callback',
          scope: ['user|email_read'],
          state: 'sample state',
          type: 'code',
          transactionID: 'transactionID',
        },
        done
      );
      expect(done).toHaveBeenCalledWith(
        null,
        {
          clientId: 'clientId',
          scopes: ['user|email_read'],
          redirectUri: 'http://localhost/callback',
        },
        'http://localhost/callback'
      );
    });

    it('should handle errors from getOAuthApp', async () => {
      const error = new Error('Database error');
      vitest.restoreAllMocks();
      vitest.spyOn(service as any, 'getOAuthApp').mockRejectedValueOnce(error);
      await service['authorizeValidate'](
        {
          clientID: 'clientId',
          redirectURI: 'http://localhost/callback',
          scope: ['read'],
          state: 'sample state',
          type: 'code',
          transactionID: 'transactionID',
        },
        done
      );
      expect(done).toHaveBeenCalledWith(error);
    });
  });

  describe('codeExchange', () => {
    let mockDone: Mock;
    let mockGenerateAccessToken: MockInstance;
    let mockGetRefreshToken: MockInstance;
    beforeEach(() => {
      mockDone = vitest.fn();
      mockGenerateAccessToken = vitest.spyOn(service as any, 'generateAccessToken');
      mockGetRefreshToken = vitest.spyOn(service as any, 'getRefreshToken');
    });

    afterEach(() => {
      mockDone.mockReset();
      mockGetRefreshToken.mockReset();
      mockGenerateAccessToken.mockReset();
    });

    it('should exchange code for tokens successfully', async () => {
      const mockClient = {
        clientId: 'clientId',
        name: 'clientName',
        secretId: 'secretId',
        type: 'secret',
        clientSecret: 'clientSecret',
      };
      const mockCode = 'validCode';
      const mockRedirectUri = 'http://redirect.uri';
      const mockCodeState = {
        clientId: 'clientId',
        redirectUri: 'http://redirect.uri',
        user: { id: 'userId' },
        scopes: ['user|email_read'],
        type: 'secret',
      };

      cacheService.get.mockResolvedValue(mockCodeState);
      cacheService.del.mockResolvedValue();
      const mockAccessToken = { id: 'accessTokenId', token: 'accessToken' };
      mockGenerateAccessToken.mockResolvedValue(mockAccessToken);
      const mockRefreshToken = 'refreshToken';
      mockGetRefreshToken.mockResolvedValue(mockRefreshToken);

      await service['codeExchange'](mockClient, mockCode, mockRedirectUri, mockDone);
      expect(mockDone).toHaveBeenCalledWith(null, mockAccessToken.token, mockRefreshToken, {
        scopes: mockCodeState.scopes,
        expires_in: expect.any(Number),
        refresh_expires_in: expect.any(Number),
      });
      expect(cacheService.get).toHaveBeenCalledWith(`oauth:code:${mockCode}`);
      expect(cacheService.del).toHaveBeenCalledWith(`oauth:code:${mockCode}`);
      expect(service['generateAccessToken']).toHaveBeenCalledWith({
        clientId: mockClient.clientId,
        clientName: mockClient.name,
        userId: mockCodeState.user.id,
        scopes: mockCodeState.scopes,
      });
      expect(service['getRefreshToken']).toHaveBeenCalledWith(
        mockClient,
        mockAccessToken.id,
        expect.any(String)
      );
      expect(prismaService.txClient().oAuthAppToken.create).toHaveBeenCalledWith({
        data: {
          clientId: mockClient.clientId,
          refreshTokenSign: expect.any(String),
          appSecretId: mockClient.secretId,
          createdBy: mockCodeState.user.id,
          expiredTime: expect.any(String),
        },
      });
    });

    it('should return an UnauthorizedException if the code is invalid', async () => {
      const mockClient = { clientId: 'clientId', name: 'clientName', secretId: 'secretId' };
      const mockCode = 'invalidCode';
      const mockRedirectUri = 'http://redirect.uri';

      cacheService.get.mockResolvedValue(undefined);

      await service['codeExchange'](mockClient, mockCode, mockRedirectUri, mockDone);

      expect(cacheService.get).toHaveBeenCalledWith(`oauth:code:${mockCode}`);
      expect(mockDone).toHaveBeenCalledWith(new UnauthorizedException('Invalid code'));
    });

    it('should return an UnauthorizedException if the clientId is invalid', async () => {
      const mockClient = { clientId: 'clientId', name: 'clientName', secretId: 'secretId' };
      const mockCode = 'validCode';
      const mockRedirectUri = 'http://redirect.uri';
      const mockCodeState = {
        clientId: 'invalidClientId',
        redirectUri: 'http://redirect.uri',
        user: { id: 'userId' },
        scopes: ['user|email_read'],
      };

      cacheService.get.mockResolvedValue(mockCodeState);

      await service['codeExchange'](mockClient, mockCode, mockRedirectUri, mockDone);

      expect(cacheService.get).toHaveBeenCalledWith(`oauth:code:${mockCode}`);
      expect(mockDone).toHaveBeenCalledWith(new UnauthorizedException('Invalid client'));
    });

    it('should return an UnauthorizedException if the redirectUri is invalid', async () => {
      const mockClient = { clientId: 'clientId', name: 'clientName', secretId: 'secretId' };
      const mockCode = 'validCode';
      const mockRedirectUri = 'http://invalid.redirect.uri';
      const mockCodeState = {
        clientId: 'clientId',
        redirectUri: 'http://redirect.uri',
        user: { id: 'userId' },
        scopes: ['user|email_read'],
      };

      cacheService.get.mockResolvedValue(mockCodeState);

      await service['codeExchange'](mockClient, mockCode, mockRedirectUri, mockDone);

      expect(cacheService.get).toHaveBeenCalledWith(`oauth:code:${mockCode}`);
      expect(mockDone).toHaveBeenCalledWith(new UnauthorizedException('Invalid redirectUri'));
    });

    it('should catch and handle errors', async () => {
      const mockClient = { clientId: 'clientId', name: 'clientName', secretId: 'secretId' };
      const mockCode = 'validCode';
      const mockRedirectUri = 'http://redirect.uri';

      cacheService.get.mockRejectedValue(new Error('Some error'));

      await service['codeExchange'](mockClient, mockCode, mockRedirectUri, mockDone);

      expect(cacheService.get).toHaveBeenCalledWith(`oauth:code:${mockCode}`);
      expect(mockDone).toHaveBeenCalledWith(new Error('Some error'));
    });
  });

  describe('refreshTokenExchange', () => {
    let mockDone: Mock;
    let mockFindAccessToken: MockInstance;
    let mockGenerateAccessToken: MockInstance;
    let mockGetRefreshToken: MockInstance;
    let mockGetRefreshTokenExpireTime: MockInstance;
    let mockUpdateRefreshToken: MockInstance;
    let mockFindAuthorized: MockInstance;

    beforeEach(() => {
      mockDone = vitest.fn();
      mockFindAccessToken = prismaService.txClient().accessToken.findUnique as any;
      mockGenerateAccessToken = vitest.spyOn(service as any, 'generateAccessToken');
      mockGetRefreshToken = vitest.spyOn(service as any, 'getRefreshToken');
      mockGetRefreshTokenExpireTime = vitest.spyOn(service as any, 'getRefreshTokenExpireTime');
      mockUpdateRefreshToken = prismaService.txClient().oAuthAppToken.update as any;
      mockFindAuthorized = prismaService.txClient().oAuthAppAuthorized.findUnique as any;
    });

    afterEach(() => {
      mockGetRefreshTokenExpireTime?.mockReset();
      mockFindAccessToken?.mockReset();
      mockGetRefreshToken?.mockReset();
      mockGenerateAccessToken?.mockReset();
      mockUpdateRefreshToken?.mockReset();
      mockDone.mockReset();
    });

    it('should refresh token successfully', async () => {
      const client = {
        type: 'secret',
        clientId: 'client1',
        clientSecret: 'secret',
        name: 'testApp',
        secretId: 'secretId',
      } as const;
      const refreshToken = 'validRefreshToken';

      const verifiedToken = {
        clientId: 'client1',
        secret: 'secret',
        accessTokenId: 'accessTokenId',
        sign: 'sign',
      };

      const oldAccessToken = {
        userId: 'userId',
        scopes: JSON.stringify(['user|email_read']),
      };

      const newAccessToken = { token: 'newAccessToken', id: 'newAccessTokenId' };
      const newRefreshToken = 'newRefreshToken';
      jwtService.verifyAsync.mockResolvedValue(verifiedToken);
      mockGenerateAccessToken.mockResolvedValue(newAccessToken);
      mockGetRefreshToken.mockResolvedValue(newRefreshToken);
      mockFindAccessToken.mockResolvedValue(oldAccessToken);
      mockUpdateRefreshToken.mockResolvedValue({ refreshTokenSign: 'refreshTokenSign' });
      mockFindAuthorized.mockResolvedValueOnce({
        clientId: client.clientId,
        userId: 'userId',
      });
      await service['refreshTokenExchange'](client, refreshToken, mockDone);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith(refreshToken);
      expect(prismaService.txClient().accessToken.findUnique).toHaveBeenCalledWith({
        where: { id: verifiedToken.accessTokenId },
      });
      expect(service['generateAccessToken']).toHaveBeenCalledWith({
        clientId: client.clientId,
        clientName: client.name,
        userId: oldAccessToken.userId,
        scopes: ['user|email_read'],
      });
      expect(prismaService.txClient().oAuthAppToken.update).toHaveBeenCalledWith({
        where: {
          clientId: client.clientId,
          refreshTokenSign: verifiedToken.sign,
          appSecretId: client.secretId,
        },
        data: {
          refreshTokenSign: expect.any(String),
          expiredTime: expect.any(String),
        },
        select: {
          refreshTokenSign: true,
        },
      });
      expect(service['getRefreshToken']).toHaveBeenCalledWith(
        client,
        newAccessToken.id,
        'refreshTokenSign'
      );
      expect(mockDone).toHaveBeenCalledWith(null, newAccessToken.token, newRefreshToken, {
        scopes: ['user|email_read'],
        expires_in: expect.any(Number),
        refresh_expires_in: expect.any(Number),
      });
    });

    it('should return unauthorized exception for invalid client', async () => {
      const client = {
        clientId: 'client1',
        clientSecret: 'secret',
        name: 'testApp',
        secretId: 'secretId',
        type: 'secret',
      } as const;
      const refreshToken = 'validRefreshToken';

      const verifiedToken = {
        clientId: 'client2', // Invalid clientId
        secret: 'secret',
        accessTokenId: 'accessTokenId',
        sign: 'sign',
      };

      jwtService.verifyAsync.mockResolvedValue(verifiedToken);

      await service['refreshTokenExchange'](client, refreshToken, mockDone);

      expect(mockDone).toHaveBeenCalledWith(new UnauthorizedException('Invalid client'));
    });

    it('should return unauthorized exception for invalid secret', async () => {
      const client = {
        clientId: 'client1',
        clientSecret: 'secret',
        name: 'testApp',
        secretId: 'secretId',
        type: 'secret',
      } as const;
      const refreshToken = 'validRefreshToken';

      const verifiedToken = {
        clientId: 'client1',
        secret: 'invalidSecret', // Invalid secret
        accessTokenId: 'accessTokenId',
        sign: 'sign',
      };

      jwtService.verifyAsync.mockResolvedValue(verifiedToken);
      mockFindAuthorized.mockResolvedValueOnce({
        clientId: client.clientId,
        userId: 'userId',
      });
      await service['refreshTokenExchange'](client, refreshToken, mockDone);

      expect(mockDone).toHaveBeenCalledWith(new UnauthorizedException('Invalid secret'));
    });

    it('should return unauthorized exception for invalid access token', async () => {
      const client = {
        clientId: 'client1',
        clientSecret: 'secret',
        name: 'testApp',
        secretId: 'secretId',
        type: 'secret',
      } as const;
      const refreshToken = 'validRefreshToken';

      const verifiedToken = {
        clientId: 'client1',
        secret: 'secret',
        accessTokenId: 'accessTokenId',
        sign: 'sign',
      };

      jwtService.verifyAsync.mockResolvedValue(verifiedToken);

      await service['refreshTokenExchange'](client, refreshToken, mockDone);

      expect(mockDone).toHaveBeenCalledWith(new UnauthorizedException('Invalid access token'));
    });

    it('should catch and return error', async () => {
      const client = {
        clientId: 'client1',
        clientSecret: 'secret',
        name: 'testApp',
        secretId: 'secretId',
        type: 'secret',
      } as const;
      const refreshToken = 'validRefreshToken';

      const verifiedToken = {
        clientId: 'client1',
        secret: 'secret',
        accessTokenId: 'accessTokenId',
        sign: 'sign',
      };
      const mockAccessToken = { id: 'accessTokenId', token: 'accessToken' };
      jwtService.verifyAsync.mockResolvedValue(verifiedToken);
      mockFindAccessToken.mockResolvedValueOnce({
        userId: 'userId',
        scopes: JSON.stringify(['user|email_read']),
      });
      mockFindAuthorized.mockResolvedValueOnce({
        clientId: client.clientId,
        userId: 'userId',
      });
      mockGenerateAccessToken.mockResolvedValue(mockAccessToken);
      mockUpdateRefreshToken.mockRejectedValueOnce(new Error('Database error'));

      await service['refreshTokenExchange'](client, refreshToken, mockDone);

      expect(mockDone).toHaveBeenCalledWith(new UnauthorizedException('Invalid refresh token'));
    });
  });

  describe('checkTokenRateLimit', () => {
    it('should pass when request count is within limit', async () => {
      cacheService.incr.mockResolvedValue(15);
      await expect(service['checkTokenRateLimit']('clientId', 'userId')).resolves.toBeUndefined();
      expect(cacheService.incr).toHaveBeenCalledWith(
        'oauth:token-rate:clientId:userId',
        expect.any(Number)
      );
    });

    it('should pass when request count equals the limit', async () => {
      cacheService.incr.mockResolvedValue(30);
      await expect(service['checkTokenRateLimit']('clientId', 'userId')).resolves.toBeUndefined();
    });

    it('should throw when request count exceeds the limit', async () => {
      cacheService.incr.mockResolvedValue(31);
      await expect(service['checkTokenRateLimit']('clientId', 'userId')).rejects.toThrow(
        new CustomHttpException(
          'Token request rate limit exceeded, please try again later',
          HttpErrorCode.TOO_MANY_REQUESTS
        )
      );
    });

    it('should use clientId:userId as the rate limit key', async () => {
      cacheService.incr.mockResolvedValue(1);
      await service['checkTokenRateLimit']('app-1', 'user-abc');
      expect(cacheService.incr).toHaveBeenCalledWith(
        'oauth:token-rate:app-1:user-abc',
        expect.any(Number)
      );
    });
  });

  describe('codeExchange rate limit', () => {
    it('should reject code exchange when rate limited', async () => {
      const mockDone = vitest.fn();
      const mockCodeState = {
        clientId: 'clientId',
        redirectUri: 'http://redirect.uri',
        user: { id: 'userId' },
        scopes: ['user|email_read'],
      };
      cacheService.get.mockResolvedValue(mockCodeState);
      cacheService.incr.mockResolvedValue(31);

      await service['codeExchange'](
        { clientId: 'clientId', name: 'clientName', secretId: 'secretId' },
        'code',
        'http://redirect.uri',
        mockDone
      );

      expect(cacheService.incr).toHaveBeenCalledWith(
        'oauth:token-rate:clientId:userId',
        expect.any(Number)
      );
      expect(mockDone).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Token request rate limit exceeded, please try again later',
        })
      );
    });
  });

  describe('refreshTokenExchange rate limit', () => {
    it('should reject refresh token exchange when rate limited', async () => {
      const mockDone = vitest.fn();

      const client = {
        clientId: 'client1',
        clientSecret: 'secret',
        name: 'testApp',
        secretId: 'secretId',
        type: 'secret',
      } as const;

      jwtService.verifyAsync.mockResolvedValue({
        clientId: 'client1',
        secret: 'secret',
        accessTokenId: 'accessTokenId',
        sign: 'sign',
      });
      (prismaService.txClient().accessToken.findUnique as any).mockResolvedValue({
        userId: 'userId',
        scopes: JSON.stringify(['user|email_read']),
      });
      cacheService.incr.mockResolvedValue(31);

      await service['refreshTokenExchange'](client, 'refreshToken', mockDone);

      expect(cacheService.incr).toHaveBeenCalledWith(
        'oauth:token-rate:client1:userId',
        expect.any(Number)
      );
      expect(mockDone).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Token request rate limit exceeded, please try again later',
        })
      );
    });
  });
});
