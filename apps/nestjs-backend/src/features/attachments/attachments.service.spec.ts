import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable/db-main-prisma';
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

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
