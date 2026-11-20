import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { AggregationOpenApiModule } from './aggregation-open-api.module';
import { AggregationOpenApiService } from './aggregation-open-api.service';

describe('AggregationOpenApiService', () => {
  let service: AggregationOpenApiService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, AggregationOpenApiModule],
    }).compile();

    service = module.get<AggregationOpenApiService>(AggregationOpenApiService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
