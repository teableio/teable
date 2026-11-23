/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { GlobalModule } from '../../global/global.module';
import { PerformanceCacheService } from '../../performance-cache';
import { Encryptor } from '../../utils/encryptor';
import { AccessTokenModel } from '../model/access-token';
import { AccessTokenLegacyCipherService } from './access-token-legacy-cipher.service';
import { currentSignTag } from './access-token.encryptor';
import { AccessTokenModule } from './access-token.module';
import { AccessTokenService, generateSign } from './access-token.service';

describe('AccessTokenService', () => {
  let accessTokenService: AccessTokenService;
  const prismaService = mockDeep<PrismaService>();
  const accessTokenModel = mockDeep<AccessTokenModel>();
  const performanceCacheService = mockDeep<PerformanceCacheService>();
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
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

  afterEach(async () => {
    await module.close();
    vitest.resetAllMocks();
    mockReset(prismaService);
    mockReset(performanceCacheService);
  });

  it('refuses to mint a personal access token from a sandbox session', async () => {
    const cls = module.get(ClsService);
    vitest
      .spyOn(cls, 'get')
      .mockImplementation(((key: string) => (key === 'authSource' ? 'sandbox' : 'usr1')) as never);

    await expect(
      accessTokenService.createAccessToken({ name: 't', scopes: ['record|read'] } as never)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaService.accessToken.create).not.toHaveBeenCalled();
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

  describe('signs and retiring key/iv', () => {
    const tokenRow = {
      id: 'acc1',
      name: 't',
      description: null,
      scopes: '["record|read"]',
      spaceIds: null,
      baseIds: null,
      hasFullAccess: null,
      expiredTime: new Date('2099-12-31T00:00:00.000Z'),
      createdTime: new Date('2026-01-01T00:00:00.000Z'),
      lastUsedTime: null,
      sign: 'SIGN',
    };
    const asUser = () => {
      const cls = module.get(ClsService);
      vitest
        .spyOn(cls, 'get')
        .mockImplementation(((key: string) => (key === 'user.id' ? 'usr1' : undefined)) as never);
    };

    it('leads a new sign with the tag of the key/iv sealing it', () => {
      const sign = generateSign();
      expect(currentSignTag()).toMatch(/^[0-9a-f]{6}$/);
      expect(sign).toMatch(new RegExp(`^${currentSignTag()}\\.[0-9a-zA-Z]{13}$`));
      expect(generateSign()).not.toBe(sign);
    });

    it('refreshes a token with a tagged sign', async () => {
      asUser();
      prismaService.accessToken.update.mockResolvedValue({
        ...tokenRow,
        expiredTime: new Date('2099-12-31T00:00:00.000Z'),
      } as any);

      await accessTokenService.refreshAccessToken('acc1');

      const { data } = prismaService.accessToken.update.mock.calls[0][0] as {
        data: { sign: string };
      };
      expect(data.sign.startsWith(`${currentSignTag()}.`)).toBe(true);
    });

    it('writes nothing when the token can not be sealed', async () => {
      asUser();
      const encrypt = vitest.spyOn(Encryptor.prototype, 'encrypt').mockImplementation(() => {
        throw new Error('Encryption failed');
      });
      try {
        await expect(
          accessTokenService.createAccessToken({
            name: 't',
            scopes: ['record|read'],
            expiredTime: '2099-12-31',
          } as never)
        ).rejects.toThrow('Encryption failed');
        expect(prismaService.accessToken.create).not.toHaveBeenCalled();

        // the stored sign stays, so the token in the holder's hands keeps working
        await expect(accessTokenService.refreshAccessToken('acc1')).rejects.toThrow(
          'Encryption failed'
        );
        expect(prismaService.accessToken.update).not.toHaveBeenCalled();
      } finally {
        encrypt.mockRestore();
      }
    });

    it('lists the mark of a token under an older key/iv, and never the sign', async () => {
      asUser();
      const legacyCipher = module.get(AccessTokenLegacyCipherService);
      const marksOf = vitest
        .spyOn(legacyCipher, 'marksOf')
        .mockReturnValue(new Map([['accOld', { stopped: false }]]));
      prismaService.accessToken.findMany.mockResolvedValue([
        { ...tokenRow, id: 'accOld' },
        { ...tokenRow, id: 'accNew' },
      ] as any);

      const list = await accessTokenService.listAccessToken();

      expect(marksOf).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'accOld', sign: 'SIGN' }),
        expect.objectContaining({ id: 'accNew', sign: 'SIGN' }),
      ]);
      expect(list.map(({ id, legacyCipher }) => ({ id, legacyCipher }))).toEqual([
        { id: 'accOld', legacyCipher: { stopped: false } },
        { id: 'accNew', legacyCipher: undefined },
      ]);
      expect(list.some((token) => 'sign' in token)).toBe(false);
    });
  });
});
