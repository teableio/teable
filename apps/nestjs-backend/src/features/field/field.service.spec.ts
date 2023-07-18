import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldModule } from './field.module';
import { FieldService } from './field.service';

describe('FieldService', () => {
  let service: FieldService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [FieldModule],
    }).compile();

    service = module.get<FieldService>(FieldService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
