import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { AttachmentsModule } from './attachments.module';
import { AttachmentsService } from './attachments.service';

describe('AttachmentsService', () => {
  let service: AttachmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AttachmentsModule],
    })
      .useMocker((token) => {
        if (token === PrismaService) {
          return jest.fn();
        }
        if (token === ClsService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<AttachmentsService>(AttachmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
