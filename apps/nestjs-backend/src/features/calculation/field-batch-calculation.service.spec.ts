import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldBatchCalculationService } from './field-batch-calculation.service';

describe('FieldBatchCalculationService', () => {
  let service: FieldBatchCalculationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FieldBatchCalculationService],
    }).compile();

    service = module.get<FieldBatchCalculationService>(FieldBatchCalculationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
