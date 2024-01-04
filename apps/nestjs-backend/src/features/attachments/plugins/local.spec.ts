/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import * as crypto from 'crypto';
import * as fs from 'fs';
import { join, resolve } from 'path';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import * as fse from 'fs-extra';
import { vi } from 'vitest';
import { CacheService } from '../../../cache/cache.service';
import type { IAttachmentLocalTokenCache } from '../../../cache/types';
import { GlobalModule } from '../../../global/global.module';
import * as fullStorageUrlModule from '../../../utils/full-storage-url';
import { LocalStorage } from './local';
import { StorageModule } from './storage.module';
import type { ILocalFileUpload } from './types';

vi.mock('fs-extra');
vi.mock('../../../utils/full-storage-url');
vi.mock('fs');
vi.mock('crypto');

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
      algorithm: 'aes-128-cbc',
      key: '73b00476e456323e',
      iv: '8c9183e4c175f63c',
    },
    tokenExpireIn: 3600,
    urlExpireIn: 3600,
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
          provide: 'STORAGE_CONFIG',
          useValue: mockConfig,
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

      await expect(storage.validateToken('invalid-token', uploadMeta)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException for expired token', async () => {
      const expiredTokenMeta = {
        ...localSignatureCache,
        expiresDate: 1000,
      };

      mockCacheService.get.mockResolvedValue(expiredTokenMeta);

      await expect(storage.validateToken('expired-token', uploadMeta)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException for size mismatch', async () => {
      mockCacheService.get.mockResolvedValue(localSignatureCache);

      await expect(
        storage.validateToken('valid-token', {
          ...uploadMeta,
          size: 2048,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for mimetype mismatch', async () => {
      mockCacheService.get.mockResolvedValue(localSignatureCache);

      await expect(
        storage.validateToken('valid-token', {
          ...uploadMeta,
          mimetype: 'image/jpeg',
        })
      ).rejects.toThrow(BadRequestException);
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
        on: vi.fn(),
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
      const mockFile = {
        path: '/mock/temp/path',
      };

      const mockRename = 'mock-rename.png';
      const mockDistPath = resolve(storage.storageDir, mockRename);
      vi.spyOn(fse, 'copy').mockResolvedValueOnce(undefined);
      vi.spyOn(fse, 'remove').mockResolvedValueOnce(undefined);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await storage.save(mockFile as any, mockRename);

      expect(fse.copy).toHaveBeenCalledWith(mockFile.path, mockDistPath);
      expect(fse.remove).toHaveBeenCalledWith(mockFile.path);
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

  describe('getHash', () => {
    it('should get file hash', async () => {
      const mockPath = '/mock/file/path';

      const mockHash = 'mock-hash';

      vi.spyOn(crypto, 'createHash').mockReturnValueOnce({
        update: vi.fn(),
        digest: vi.fn().mockReturnValueOnce(mockHash),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      vi.spyOn(fs, 'createReadStream').mockReturnValue({
        on: (_event: string, callback: () => void) => {
          callback();
        },
      } as any);
      const result = await storage.getHash(mockPath);

      expect(result).toBe(mockHash);
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

      const result = await storage.getObject(mockBucket, mockPath, mockToken);

      expect(mockCacheService.get).toHaveBeenCalledWith(`attachment:upload:${mockToken}`);
      expect(storage.getFileMate).toHaveBeenCalledWith(
        resolve(storage.storageDir, mockBucket, mockPath)
      );
      expect(storage['getUrl']).toHaveBeenCalledWith(mockPath, {
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

    it('should throw BadRequestException for invalid token', async () => {
      vi.spyOn(mockCacheService, 'get').mockResolvedValueOnce(null);

      await expect(
        storage.getObject('mock-bucket', 'mock/file/path', 'invalid-token')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPreviewUrl', () => {
    it('should get preview URL', async () => {
      const mockBucket = 'mock-bucket';
      const mockPath = 'mock/file/path';
      const mockExpiresIn = 3600;

      vi.spyOn(storage.expireTokenEncryptor, 'encrypt').mockReturnValueOnce('mock-token');
      vi.spyOn(fullStorageUrlModule, 'getFullStorageUrl').mockReturnValueOnce('http://example.com');

      const result = await storage.getPreviewUrl(
        mockBucket,
        mockPath,
        mockExpiresIn,
        mockRespHeaders
      );

      expect(storage.expireTokenEncryptor.encrypt).toHaveBeenCalledWith({
        expiresDate: Math.floor(Date.now() / 1000) + mockExpiresIn,
        path: mockPath,
        respHeaders: mockRespHeaders,
      });
      expect(fullStorageUrlModule.getFullStorageUrl).toHaveBeenCalledWith(
        '/api/attachments/read?token=mock-token'
      );
      expect(result).toBe('http://example.com');
    });
  });

  describe('verifyReadToken', () => {
    const expiresDate = Math.floor(Date.now() / 1000) + 100000;
    it('should verify read token', () => {
      vi.spyOn(storage.expireTokenEncryptor, 'decrypt').mockReturnValueOnce({
        expiresDate,
        respHeaders: mockRespHeaders,
      });

      const result = storage.verifyReadToken('mock-token');

      expect(storage.expireTokenEncryptor.decrypt).toHaveBeenCalledWith('mock-token');

      expect(result).toEqual({
        respHeaders: mockRespHeaders,
      });
    });

    it('should throw BadRequestException for expired token', () => {
      vi.spyOn(storage.expireTokenEncryptor, 'decrypt').mockReturnValueOnce({
        expiresDate: 1,
      });

      expect(() => storage.verifyReadToken('expired-token')).toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid token', () => {
      vi.spyOn(storage.expireTokenEncryptor, 'decrypt').mockImplementationOnce(() => {
        throw new Error();
      });

      expect(() => storage.verifyReadToken('invalid-token')).toThrow(BadRequestException);
    });
  });
});
