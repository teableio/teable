import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SelectionController } from './selection.controller';

describe('SelectionController', () => {
  let controller: SelectionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SelectionController],
    }).compile();

    controller = module.get<SelectionController>(SelectionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
