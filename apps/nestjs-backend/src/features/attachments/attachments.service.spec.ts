/* eslint-disable @typescript-eslint/naming-convention */
import { Readable } from 'node:stream';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable/db-main-prisma';
import { axios } from '@teable/openapi';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { getError } from '../../../test/utils/get-error';
import { storageConfig } from '../../configs/storage';
import { GlobalModule } from '../../global/global.module';
import { AttachmentsModule } from './attachments.module';
import { AttachmentsService } from './attachments.service';
import type { LocalStorage } from './plugins/local';

describe('AttachmentsService', () => {
  let service: AttachmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AttachmentsModule, GlobalModule],
    })
      .useMocker((token) => {
        if (token === ClsService || token === PrismaService) {
          return vi.fn();
        }
      })
      .compile();

    service = module.get<AttachmentsService>(AttachmentsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('parses normalized Axios response headers', async () => {
    const headers = new AxiosHeaders();
    headers.set('content-length', '42');
    headers.set('content-type', 'image/png');
    vi.spyOn(axios, 'head').mockResolvedValue({
      headers,
    } as AxiosResponse);

    const result = await (
      service as unknown as {
        getFileInfo: (
          fileUrl: string,
          maxFileSize: number
        ) => Promise<{ contentLength: number; contentType: string; tempFilePath: string | null }>;
      }
    ).getFileInfo('https://example.com/image', 100);

    expect(result).toEqual({
      contentLength: 42,
      contentType: 'image/png',
      tempFilePath: null,
    });
  });

  describe('readLocalFile', () => {
    const findUnique = vi.fn();
    let localStorage: LocalStorage;
    let privateBucket: string;
    let publicBucket: string;

    const mintToken = (path: string, respHeaders?: Record<string, string>) =>
      localStorage.readTokenCodec.encode({ path, expiresDate: -1, respHeaders });

    beforeEach(() => {
      ({ privateBucket, publicBucket } = storageConfig());
      localStorage = service.storageAdapter as LocalStorage;
      findUnique.mockReset();
      Object.assign(service['prismaService'], {
        txClient: () => ({ attachments: { findUnique } }),
      });
      vi.spyOn(localStorage, 'read').mockImplementation(
        () => Readable.from([]) as ReturnType<LocalStorage['read']>
      );
    });

    it('rejects a private object without a token before touching storage', async () => {
      const error = await getError(() => service.readLocalFile(`${privateBucket}/table/a`));

      expect(error?.message).toBe('Invalid token');
      expect(error?.status).toBe(400);
      expect(findUnique).not.toHaveBeenCalled();
      expect(localStorage.read).not.toHaveBeenCalled();
    });

    it('rejects a token minted for another private object', async () => {
      const token = mintToken(`${privateBucket}/table/a`);

      const error = await getError(() => service.readLocalFile(`${privateBucket}/table/b`, token));

      expect(error?.message).toBe('Invalid token');
      expect(localStorage.read).not.toHaveBeenCalled();
    });

    it('serves a private object with the token minted for it', async () => {
      const path = `${privateBucket}/table/a`;
      const token = mintToken(path, { 'Content-Type': 'image/png' });

      const { headers } = await service.readLocalFile(path, token);

      expect(headers).toEqual({ 'Content-Type': 'image/png' });
      expect(localStorage.read).toHaveBeenCalledWith(path);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('forces a download for active content whatever the token says', async () => {
      const path = `${privateBucket}/table/a`;

      const plain = await service.readLocalFile(
        path,
        mintToken(path, { 'Content-Type': 'image/svg+xml' })
      );
      expect(plain.headers['Content-Disposition']).toBe('attachment');

      const inline = await service.readLocalFile(
        path,
        mintToken(path, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': 'inline; filename="page.html"',
        })
      );
      expect(inline.headers['Content-Disposition']).toBe('attachment; filename="page.html"');
    });

    it('never serves backend-only prefixes, even with a token sealed to them', async () => {
      for (const dir of [
        'record-history',
        'record-removal',
        'workflow-run',
        'audit-log',
        'artifact',
      ]) {
        const path = `${privateBucket}/${dir}/v1/tbl/_stats.json`;
        const error = await getError(() => service.readLocalFile(path, mintToken(path)));
        expect(error?.message).toBe('Invalid path');
        expect(error?.status).toBe(400);
      }
      expect(localStorage.read).not.toHaveBeenCalled();
    });

    it('serves a public object from its attachment row with its real mimetype', async () => {
      findUnique.mockResolvedValue({ mimetype: 'image/png' });

      const { headers } = await service.readLocalFile(`${publicBucket}/avatar/usr1`);

      expect(findUnique).toHaveBeenCalledWith({ where: { token: 'usr1', deletedTime: null } });
      expect(headers).toEqual({ 'Content-Type': 'image/png' });
      expect(localStorage.read).toHaveBeenCalledWith(`${publicBucket}/avatar/usr1`);
    });

    it('rejects a public path without a live attachment row', async () => {
      findUnique.mockResolvedValue(null);

      const error = await getError(() => service.readLocalFile(`${publicBucket}/avatar/usr1`));

      expect(error?.message).toBe('Invalid path');
      expect(error?.status).toBe(400);
      expect(localStorage.read).not.toHaveBeenCalled();
    });
  });
});
