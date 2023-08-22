import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldConvertingService } from './field-converting.service';

describe('FieldConvertingService', () => {
  let service: FieldConvertingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FieldConvertingService],
    }).compile();

    service = module.get<FieldConvertingService>(FieldConvertingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
