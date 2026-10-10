/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import * as fs from 'fs';
import { join, resolve } from 'path';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import * as fse from 'fs-extra';
import { vi } from 'vitest';
import { getError } from '../../../../test/utils/get-error';
import { CacheService } from '../../../cache/cache.service';
import type { IAttachmentLocalTokenCache } from '../../../cache/types';
import { baseConfig } from '../../../configs/base.config';
import { storageConfig } from '../../../configs/storage';
import { GlobalModule } from '../../../global/global.module';
import { LocalStorage } from './local';
import { LocalReadTokenCodec, type ILocalReadTokenPayload } from './local-read-token';
import { StorageModule } from './storage.module';
import type { ILocalFileUpload } from './types';

vi.mock('fs-extra');
vi.mock('fs');

describe('LocalStorage', () => {
  let storage: LocalStorage;
  const imageType = 'image/png';
  const imageMeta = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Content-Type': imageType,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Content-Length': 1024,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockConfig: any = {
    local: {
      path: '/mock/path',
    },
    encryption: {
      entries: [{ algorithm: 'aes-128-cbc', key: '73b00476e456323e', iv: '8c9183e4c175f63c' }],
    },
    tokenExpireIn: '7d',
    urlExpireIn: '7d',
  };

  const mockBaseConfig: any = {
    storagePrefix: 'https://example.com',
  };

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const mockRespHeaders = { 'Content-Type': imageType };

  const mockCacheService = {
    set: vi.fn(),
    get: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [StorageModule, GlobalModule],
      providers: [
        LocalStorage,
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
        {
          provide: storageConfig.KEY,
          useValue: mockConfig,
        },
        {
          provide: baseConfig.KEY,
          useValue: mockBaseConfig,
        },
      ],
    }).compile();

    storage = module.get<LocalStorage>(LocalStorage);
  });

  describe('presigned', () => {
    it('should generate presigned URL', async () => {
      const mockDir = '/mock/dir';
      const mockParams = {
        contentType: imageType,
        contentLength: 1024,
        hash: 'mock-hash',
      };

      const result = await storage.presigned('bucket', mockDir, mockParams);

      expect(mockCacheService.set).toHaveBeenCalled();
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('path', '/mock/dir/mock-hash');
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('uploadMethod', 'PUT');
      expect(result).toHaveProperty('requestHeaders', imageMeta);
    });
  });

  describe('validateToken', () => {
    const localSignatureCache: IAttachmentLocalTokenCache = {
      expiresDate: Math.floor(Date.now() / 1000) + 100000,
      contentLength: imageMeta['Content-Length'],
      contentType: imageMeta['Content-Type'],
    };
    const uploadMeta: ILocalFileUpload = {
      path: '',
      size: imageMeta['Content-Length'],
      mimetype: imageMeta['Content-Type'],
    };
    it('should throw BadRequestException for invalid token', async () => {
      mockCacheService.get.mockResolvedValue(null);

      const error = await getError(() => storage.validateToken('invalid-token', uploadMeta));
      expect(error).toBeDefined();
      expect(error?.message).toBe('Invalid token');
      expect(error?.status).toBe(400);
    });

    it('should throw BadRequestException for expired token', async () => {
      const expiredTokenMeta = {
        ...localSignatureCache,
        expiresDate: 1000,
      };

      mockCacheService.get.mockResolvedValue(expiredTokenMeta);

      const error = await getError(() => storage.validateToken('expired-token', uploadMeta));
      expect(error).toBeDefined();
      expect(error?.message).toBe('Token has expired');
      expect(error?.status).toBe(400);
    });

    it('should throw BadRequestException for size mismatch', async () => {
      mockCacheService.get.mockResolvedValue(localSignatureCache);

      const error = await getError(() =>
        storage.validateToken('valid-token', {
          ...uploadMeta,
          size: 2048,
        })
      );
      expect(error).toBeDefined();
      expect(error?.message).toBe('Size mismatch');
      expect(error?.status).toBe(400);
    });

    it('should throw BadRequestException for mimetype mismatch', async () => {
      mockCacheService.get.mockResolvedValue(localSignatureCache);

      const error = await getError(() =>
        storage.validateToken('valid-token', {
          ...uploadMeta,
          mimetype: 'image/jpeg',
        })
      );
      expect(error).toBeDefined();
      expect(error?.message).toBe('Not allow upload image/jpeg file');
      expect(error?.status).toBe(400);
    });

    it('should not throw error for valid token', async () => {
      mockCacheService.get.mockResolvedValue(localSignatureCache);

      await expect(storage.validateToken('valid-token', uploadMeta)).resolves.not.toThrow();
    });
  });

  describe('saveTemporaryFile', () => {
    it('should save temporary file', async () => {
      const mockRequest = {
        on: vi.fn(),
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'content-type': imageType,
        },
      };

      vi.spyOn(storage as any, 'deleteFile').mockResolvedValueOnce(undefined);
      vi.spyOn(fs, 'createWriteStream').mockReturnValue({
        write: vi.fn(),
        end: vi.fn(),
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'finish') {
            callback();
          }
        }),
      } as any);
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback('mock-data');
        } else if (event === 'end') {
          callback();
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await storage.saveTemporaryFile(mockRequest as any);

      expect(result).toHaveProperty('size', 'mock-data'.length);
      expect(result).toHaveProperty('mimetype', imageType);
      expect(result).toHaveProperty('path');
    });
  });

  describe('save', () => {
    it('should save file to storage', async () => {
      const mockFilePath = '/mock/temp/path';

      const mockRename = 'mock-rename.png';
      const mockDistPath = resolve(storage.storageDir, mockRename);
      vi.spyOn(fse, 'copy').mockResolvedValueOnce(undefined);
      vi.spyOn(fs, 'unlinkSync').mockResolvedValueOnce(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await storage.save(mockFilePath, mockRename);

      expect(fse.copy).toHaveBeenCalledWith(mockFilePath, mockDistPath);
      expect(fs.unlinkSync).toHaveBeenCalledWith(mockFilePath);
      expect(result).toBe(join(storage.path, mockRename));
    });
  });

  describe('read', () => {
    it('should create read stream', async () => {
      const mockPath = '/mock/file/path';

      vi.spyOn(fs, 'createReadStream').mockResolvedValueOnce(undefined as any);
      storage.read(mockPath);
      expect(fs.createReadStream).toHaveBeenCalledWith(resolve(storage.storageDir, mockPath));
    });
  });

  describe('downloadFile', () => {
    it('should create read stream when file exists', async () => {
      vi.spyOn(fs.promises, 'access').mockResolvedValueOnce(undefined as never);
      vi.spyOn(fs, 'createReadStream').mockReturnValueOnce(undefined as any);

      await storage.downloadFile('private', 'chat-file/token');

      expect(fs.createReadStream).toHaveBeenCalledWith(
        resolve(storage.storageDir, 'private', 'chat-file/token')
      );
    });

    it('should reject with the fs error instead of returning an erroring stream when file is missing', async () => {
      const missing = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT',
      });
      vi.spyOn(fs.promises, 'access').mockRejectedValueOnce(missing);
      const createReadStream = vi.spyOn(fs, 'createReadStream').mockClear();

      await expect(storage.downloadFile('private', 'chat-file/token_lg')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(createReadStream).not.toHaveBeenCalled();
    });
  });

  describe('getFileMate', () => {
    it('should get file metadata', async () => {
      const mockPath = '/mock/file/path';
      vi.mock('sharp', () => {
        return {
          default: () => ({
            metadata: () => ({
              width: 100,
              height: 200,
            }),
          }),
        };
      });
      const result = await storage.getFileMate(mockPath);

      expect(result).toEqual({ width: 100, height: 200 });
    });
  });

  describe('getObject', () => {
    it('should get object metadata', async () => {
      const mockBucket = 'mock-bucket';
      const mockPath = 'mock/file/path';
      const mockToken = 'mock-token';
      const mockCacheValue = {
        mimetype: imageType,
        hash: 'mock-hash',
        size: 1024,
      };
      const mockUrl = 'url';

      vi.spyOn(mockCacheService, 'get').mockResolvedValueOnce(mockCacheValue);
      vi.spyOn(storage, 'getFileMate').mockResolvedValueOnce({
        width: 100,
        height: 200,
      });
      vi.spyOn(storage as any, 'getUrl').mockReturnValue(mockUrl);

      const result = await storage.getObjectMeta(mockBucket, mockPath, mockToken);

      expect(mockCacheService.get).toHaveBeenCalledWith(`attachment:upload:${mockToken}`);
      expect(storage.getFileMate).toHaveBeenCalledWith(
        resolve(storage.storageDir, mockBucket, mockPath)
      );
      expect(storage['getUrl']).toHaveBeenCalledWith(mockBucket, mockPath, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        respHeaders: mockRespHeaders,
        expiresDate: -1,
      });
      expect(result).toEqual({
        hash: 'mock-hash',
        mimetype: imageType,
        size: 1024,
        url: mockUrl,
        width: 100,
        height: 200,
      });
    });

    it('should get object metadata not image', async () => {
      const mockBucket = 'mock-bucket';
      const mockPath = 'mock/file/path';
      const mockToken = 'mock-token';
      const mockCacheValue = {
        mimetype: 'text/plain',
        hash: 'mock-hash',
        size: 1024,
      };
      const mockUrl = 'url';

      vi.spyOn(mockCacheService, 'get').mockResolvedValueOnce(mockCacheValue);
      vi.spyOn(storage as any, 'getUrl').mockReturnValue(mockUrl);

      const result = await storage.getObjectMeta(mockBucket, mockPath, mockToken);

      expect(mockCacheService.get).toHaveBeenCalledWith(`attachment:upload:${mockToken}`);
      expect(storage['getUrl']).toHaveBeenCalledWith(mockBucket, mockPath, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        respHeaders: { 'Content-Type': 'text/plain' },
        expiresDate: -1,
      });
      expect(result).toEqual({
        hash: 'mock-hash',
        mimetype: 'text/plain',
        size: 1024,
        url: mockUrl,
      });
    });

    it('should throw BadRequestException for invalid token', async () => {
      vi.spyOn(mockCacheService, 'get').mockResolvedValueOnce(null);

      const error = await getError(() =>
        storage.getObjectMeta('mock-bucket', 'mock/file/path', 'invalid-token')
      );
      expect(error).toBeDefined();
      expect(error?.message).toBe('Invalid token');
      expect(error?.status).toBe(400);
    });
  });

  describe('getPreviewUrl', () => {
    const mockBucket = 'mock-bucket';
    const mockPath = 'mock/file/path';
    const mockExpiresIn = 3600;

    it('should get preview URL', async () => {
      vi.spyOn(storage.readTokenCodec, 'encode').mockReturnValueOnce('mock-token');

      const result = await storage.getPreviewUrl(
        mockBucket,
        mockPath,
        mockExpiresIn,
        mockRespHeaders
      );

      expect(storage.readTokenCodec.encode).toHaveBeenCalledWith({
        expiresDate: Math.floor(Date.now() / 1000) + mockExpiresIn,
        respHeaders: mockRespHeaders,
        path: 'mock-bucket/mock/file/path',
      });
      expect(result).toBe('/api/attachments/read/mock-bucket/mock/file/path?token=mock-token');
    });

    it('seals the object path into a fresh token per url', async () => {
      const tokenOf = (url: string) => new URL(url, 'http://localhost').searchParams.get('token')!;
      const first = tokenOf(await storage.getPreviewUrl(mockBucket, mockPath, mockExpiresIn));
      const second = tokenOf(await storage.getPreviewUrl(mockBucket, mockPath, mockExpiresIn));

      // same object, same expiry window — still no shared bytes to replay
      expect(first).not.toBe(second);
      expect(first).toMatch(/^[\w-]+$/);
      for (const token of [first, second]) {
        expect(storage.readTokenCodec.decode(token)).toMatchObject({
          path: 'mock-bucket/mock/file/path',
          expiresDate: Math.floor(Date.now() / 1000) + mockExpiresIn,
        });
      }
    });
  });

  describe('verifyReadToken', () => {
    const objectPath = 'mock-bucket/mock/file/path';
    const expiresDate = Math.floor(Date.now() / 1000) + 100000;
    const mintToken = (overrides: Partial<ILocalReadTokenPayload> = {}) =>
      storage.readTokenCodec.encode({
        path: objectPath,
        expiresDate,
        respHeaders: mockRespHeaders,
        ...overrides,
      });

    it('should verify read token for the object it was minted for', () => {
      const result = storage.verifyReadToken(mintToken(), objectPath);

      expect(result).toEqual({
        respHeaders: mockRespHeaders,
      });
    });

    it('accepts a never-expiring token', () => {
      expect(storage.verifyReadToken(mintToken({ expiresDate: -1 }), objectPath)).toEqual({
        respHeaders: mockRespHeaders,
      });
    });

    it('accepts an equivalent spelling of the same object path', () => {
      expect(storage.verifyReadToken(mintToken(), 'mock-bucket//mock/./file/path')).toBeDefined();
    });

    it('rejects the token on any other object path', async () => {
      for (const other of [
        'mock-bucket/mock/file/other',
        'mock-bucket/mock/file/path_sm',
        'other-bucket/mock/file/path',
        'mock-bucket/record-history/v1/tbl/_stats.json',
      ]) {
        const error = await getError(() => storage.verifyReadToken(mintToken(), other));
        expect(error?.message).toBe('Invalid token');
        expect(error?.status).toBe(400);
      }
    });

    it('rejects a legacy payload without the path claim', async () => {
      vi.spyOn(storage.readTokenCodec, 'decode').mockReturnValueOnce({
        expiresDate,
        respHeaders: mockRespHeaders,
      } as unknown as ILocalReadTokenPayload);

      const error = await getError(() => storage.verifyReadToken('legacy-token', objectPath));
      expect(error?.message).toBe('Invalid token');
      expect(error?.status).toBe(400);
    });

    it('rejects a tampered token', async () => {
      const token = mintToken();
      const flipped = token[20] === 'A' ? 'B' : 'A';
      const tampered = token.slice(0, 20) + flipped + token.slice(21);

      const error = await getError(() => storage.verifyReadToken(tampered, objectPath));
      expect(error?.message).toBe('Invalid token');
      expect(error?.status).toBe(400);
    });

    it('rejects a token sealed under another key', async () => {
      const foreign = new LocalReadTokenCodec([
        { algorithm: 'aes-128-cbc', key: 'ffffffffffffffff', iv: 'eeeeeeeeeeeeeeee' },
      ]).encode({ path: objectPath, expiresDate, respHeaders: mockRespHeaders });

      const error = await getError(() => storage.verifyReadToken(foreign, objectPath));
      expect(error?.message).toBe('Invalid token');
      expect(error?.status).toBe(400);
    });

    it('should throw BadRequestException for expired token', async () => {
      const error = await getError(() =>
        storage.verifyReadToken(mintToken({ expiresDate: 1 }), objectPath)
      );
      expect(error).toBeDefined();
      expect(error?.message).toBe('Token has expired');
      expect(error?.status).toBe(400);
    });

    it('should throw BadRequestException for invalid token', async () => {
      const error = await getError(() => storage.verifyReadToken('invalid-token', objectPath));
      expect(error).toBeDefined();
      expect(error?.message).toBe('Invalid token');
      expect(error?.status).toBe(400);
    });
  });
});
