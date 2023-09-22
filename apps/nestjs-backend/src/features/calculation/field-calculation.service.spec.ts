import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { CalculationModule } from './calculation.module';
import { FieldCalculationService } from './field-calculation.service';

describe('FieldCalculationService', () => {
  let service: FieldCalculationService;

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

    service = module.get<FieldCalculationService>(FieldCalculationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
