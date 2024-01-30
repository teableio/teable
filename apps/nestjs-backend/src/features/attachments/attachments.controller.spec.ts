import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable/db-main-prisma';
import { vi } from 'vitest';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsModule } from './attachments.module';

describe('AttachmentsController', () => {
  let controller: AttachmentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttachmentsController],
      imports: [AttachmentsModule],
    })
      .useMocker((token) => {
        if (token === PrismaService) {
          return vi.fn();
        }
      })
      .compile();

    controller = module.get<AttachmentsController>(AttachmentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
