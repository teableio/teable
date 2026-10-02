import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable/db-main-prisma';
import { axios } from '@teable/openapi';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { GlobalModule } from '../../global/global.module';
import { AttachmentsModule } from './attachments.module';
import { AttachmentsService } from './attachments.service';

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
});
