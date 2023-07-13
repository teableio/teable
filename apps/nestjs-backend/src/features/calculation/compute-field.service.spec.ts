import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ComputeFieldService } from './compute-field.service';

describe('ComputeFieldService', () => {
  let service: ComputeFieldService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ComputeFieldService],
    }).compile();

    service = module.get<ComputeFieldService>(ComputeFieldService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
