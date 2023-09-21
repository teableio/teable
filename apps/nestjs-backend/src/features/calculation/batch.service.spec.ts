import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { BatchService } from './batch.service';
import { CalculationModule } from './calculation.module';

describe('BatchService', () => {
  let service: BatchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [CalculationModule],
    })
      .useMocker((token) => {
        if (token === ClsService) {
          return jest.fn();
        }
        if (token === PrismaService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<BatchService>(BatchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
