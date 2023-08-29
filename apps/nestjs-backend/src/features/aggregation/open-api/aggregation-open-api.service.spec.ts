import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { AggregationService } from '../aggregation.service';
import { AggregationOpenApiService } from './aggregation-open-api.service';

describe('AggregationOpenApiService', () => {
  let service: AggregationOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AggregationOpenApiService, AggregationService],
    })
      .useMocker((token) => {
        if (token === PrismaService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<AggregationOpenApiService>(AggregationOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
