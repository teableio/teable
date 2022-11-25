import { Test, TestingModule } from '@nestjs/testing';
import { TeableController } from './teable.controller';

describe('TeableController', () => {
  let controller: TeableController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeableController],
    }).compile();

    controller = module.get<TeableController>(TeableController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
