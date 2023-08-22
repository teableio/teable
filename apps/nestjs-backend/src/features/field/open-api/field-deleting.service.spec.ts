import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldDeletingService } from './field-deleting.service';

describe('FieldDeletingService', () => {
  let service: FieldDeletingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FieldDeletingService],
    }).compile();

    service = module.get<FieldDeletingService>(FieldDeletingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
