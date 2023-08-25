import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AggregationOpenApiController } from './aggregation-open-api.controller';

describe('AggregationOpenApiController', () => {
  let controller: AggregationOpenApiController;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AggregationOpenApiController],
    }).compile();

    controller = module.get<AggregationOpenApiController>(AggregationOpenApiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
