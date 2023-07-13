import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsModule } from './attachments.module';

describe('AttachmentsController', () => {
  let controller: AttachmentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttachmentsController],
      imports: [AttachmentsModule],
    }).compile();

    controller = module.get<AttachmentsController>(AttachmentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
