import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { RecordOpenApiController } from './record-open-api.controller';

describe('RecordOpenApiController', () => {
  let controller: RecordOpenApiController;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordOpenApiController],
    }).compile();

    controller = module.get<RecordOpenApiController>(RecordOpenApiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
