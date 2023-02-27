import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ViewOpenApiController } from './view-open-api.controller';

describe('ViewOpenApiController', () => {
  let controller: ViewOpenApiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ViewOpenApiController],
    }).compile();

    controller = module.get<ViewOpenApiController>(ViewOpenApiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
