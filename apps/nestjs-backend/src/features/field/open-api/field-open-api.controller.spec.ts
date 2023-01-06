import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldOpenApiController } from './field-open-api.controller';

describe('FieldOpenApiController', () => {
  let controller: FieldOpenApiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FieldOpenApiController],
    }).compile();

    controller = module.get<FieldOpenApiController>(FieldOpenApiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
