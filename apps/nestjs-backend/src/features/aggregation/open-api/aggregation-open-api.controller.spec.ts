import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable/db-main-prisma';
import { vi } from 'vitest';
import { AggregationService } from '../aggregation.service';
import { AGGREGATION_SERVICE_SYMBOL } from '../aggregation.service.symbol';
import { AggregationOpenApiController } from './aggregation-open-api.controller';
import { AggregationOpenApiService } from './aggregation-open-api.service';

describe('AggregationOpenApiController', () => {
  let controller: AggregationOpenApiController;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AggregationOpenApiController],
      providers: [
        AggregationOpenApiService,
        AggregationService,
        {
          provide: AGGREGATION_SERVICE_SYMBOL,
          useClass: AggregationService,
        },
      ],
    })
      .useMocker((token) => {
        if (token === PrismaService) {
          return vi.fn();
        }
      })
      .compile();

    controller = module.get<AggregationOpenApiController>(AggregationOpenApiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
