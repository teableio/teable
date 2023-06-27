import { Test, TestingModule } from '@nestjs/testing';
import { CopyPasteController } from './copy-paste.controller';

describe('CopyPasteController', () => {
  let controller: CopyPasteController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CopyPasteController],
    }).compile();

    controller = module.get<CopyPasteController>(CopyPasteController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
