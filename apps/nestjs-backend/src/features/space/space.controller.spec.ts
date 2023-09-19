import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SpaceController } from './space.controller';

describe('SpaceController', () => {
  let controller: SpaceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SpaceController],
    }).compile();

    controller = module.get<SpaceController>(SpaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
