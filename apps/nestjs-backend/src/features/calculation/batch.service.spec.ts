import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { BatchService } from './batch.service';
import { CalculationModule } from './calculation.module';

describe('BatchService', () => {
  let service: BatchService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, CalculationModule],
    }).compile();

    service = module.get<BatchService>(BatchService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
