import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldSupplementService } from './field-supplement.service';

describe('FieldSupplementService', () => {
  let service: FieldSupplementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FieldSupplementService],
    }).compile();

    service = module.get<FieldSupplementService>(FieldSupplementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
