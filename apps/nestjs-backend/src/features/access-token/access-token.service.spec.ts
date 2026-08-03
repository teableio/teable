/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnauthorizedException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable/db-main-prisma';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { GlobalModule } from '../../global/global.module';
import { PerformanceCacheService } from '../../performance-cache';
import { AccessTokenModel } from '../model/access-token';
import { AccessTokenModule } from './access-token.module';
import { AccessTokenService } from './access-token.service';

describe('AccessTokenService', () => {
  let accessTokenService: AccessTokenService;
  const prismaService = mockDeep<PrismaService>();
  const accessTokenModel = mockDeep<AccessTokenModel>();
  const performanceCacheService = mockDeep<PerformanceCacheService>();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, AccessTokenModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .overrideProvider(AccessTokenModel)
      .useValue(accessTokenModel)
      .overrideProvider(PerformanceCacheService)
      .useValue(performanceCacheService)
      .compile();

    accessTokenService = module.get<AccessTokenService>(AccessTokenService);

    prismaService.txClient.mockImplementation(() => {
      return prismaService;
    });

    prismaService.$tx.mockImplementation(async (fn, _options) => {
      return await fn(prismaService);
    });
  });

  afterEach(() => {
    vitest.resetAllMocks();
    mockReset(prismaService);
    mockReset(performanceCacheService);
  });

  it('should be defined', () => {
    expect(accessTokenService).toBeDefined();
  });

  describe('validate', () => {
    it('should validate access token successfully', async () => {
      // Mock data
      const accessTokenId = '123';
      const sign = 'SIGN';
      const expiredTime = new Date(Date.now() + 2000); // Expires in 2 seconds
      // Mock PrismaService response
      accessTokenModel.getAccessTokenRawById.mockResolvedValue({
        userId: 'user123',
        id: accessTokenId,
        sign,
        expiredTime,
      } as any);
      prismaService.accessToken.updateMany.mockResolvedValue({ count: 1 } as any);

      // Call the validate method
      const result = await accessTokenService.validate({ accessTokenId, sign });

      // Validate the result
      expect(result.userId).toEqual('user123');
      expect(result.accessTokenId).toEqual(accessTokenId);

      // Validate that accessToken.updateMany was called with a throttled lastUsedTime update.
      expect(prismaService.txClient().accessToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: accessTokenId,
          OR: [{ lastUsedTime: null }, { lastUsedTime: { lt: expect.any(Date) } }],
        },
        data: { lastUsedTime: expect.any(String) }, // It updates lastUsedTime to current time
      });
      expect(performanceCacheService.del).not.toHaveBeenCalled();
      expect(prismaService.accessToken.findUnique).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when cached token was deleted before lastUsedTime update', async () => {
      const accessTokenId = '123';
      const sign = 'SIGN';

      accessTokenModel.getAccessTokenRawById.mockResolvedValue({
        userId: 'user123',
        id: accessTokenId,
        sign,
        expiredTime: new Date(Date.now() + 2000).toISOString(),
      } as any);
      prismaService.accessToken.updateMany.mockResolvedValue({ count: 0 } as any);
      prismaService.accessToken.findUnique.mockResolvedValue(null);

      await expect(accessTokenService.validate({ accessTokenId, sign })).rejects.toThrowError(
        new UnauthorizedException('token not found')
      );
      expect(performanceCacheService.del).toHaveBeenCalled();
    });

    it('should keep validating when lastUsedTime was refreshed by another request', async () => {
      const accessTokenId = '123';
      const sign = 'SIGN';

      accessTokenModel.getAccessTokenRawById.mockResolvedValue({
        userId: 'user123',
        id: accessTokenId,
        sign,
        expiredTime: new Date(Date.now() + 2000).toISOString(),
      } as any);
      prismaService.accessToken.updateMany.mockResolvedValue({ count: 0 } as any);
      prismaService.accessToken.findUnique.mockResolvedValue({ id: accessTokenId } as any);

      const result = await accessTokenService.validate({ accessTokenId, sign });

      expect(result).toEqual({ userId: 'user123', accessTokenId });
      expect(performanceCacheService.del).not.toHaveBeenCalled();
    });

    it('skips lastUsedTime update when it was refreshed recently', async () => {
      const accessTokenId = '123';
      const sign = 'SIGN';

      accessTokenModel.getAccessTokenRawById.mockResolvedValue({
        userId: 'user123',
        id: accessTokenId,
        sign,
        expiredTime: new Date(Date.now() + 2000).toISOString(),
        lastUsedTime: new Date().toISOString(),
      } as any);

      const result = await accessTokenService.validate({ accessTokenId, sign });

      expect(result.userId).toEqual('user123');
      expect(prismaService.txClient().accessToken.updateMany).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for invalid sign', async () => {
      // Mock data
      const accessTokenId = '123';
      const sign = 'INVALID_SIGN';

      // Mock PrismaService response
      accessTokenModel.getAccessTokenRawById.mockResolvedValue({
        userId: 'user123',
        id: accessTokenId,
        sign: 'VALID_SIGN',
        expiredTime: new Date(),
      } as any);

      // Call the validate method and expect it to throw UnauthorizedException
      await expect(accessTokenService.validate({ accessTokenId, sign })).rejects.toThrowError(
        new UnauthorizedException('sign error')
      );

      // Ensure accessToken.updateMany is not called in this case
      expect(prismaService.txClient().accessToken.updateMany).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for expired token', async () => {
      // Mock data
      const accessTokenId = '123';
      const sign = 'VALID_SIGN';
      const expiredTime = new Date(Date.now() - 1500); // Expired 1 second ago

      // Mock PrismaService response
      accessTokenModel.getAccessTokenRawById.mockResolvedValue({
        userId: 'user123',
        id: accessTokenId,
        sign,
        expiredTime,
      } as any);

      // Call the validate method and expect it to throw UnauthorizedException
      await expect(accessTokenService.validate({ accessTokenId, sign })).rejects.toThrowError(
        new UnauthorizedException('token expired')
      );

      // Ensure accessToken.updateMany is not called in this case
      expect(prismaService.txClient().accessToken.updateMany).not.toHaveBeenCalled();
    });
  });
});
