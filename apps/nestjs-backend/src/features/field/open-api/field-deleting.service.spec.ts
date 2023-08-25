import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldDeletingService } from './field-deleting.service';
import { FieldOpenApiModule } from './field-open-api.module';

describe('FieldDeletingService', () => {
  let service: FieldDeletingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [FieldOpenApiModule],
    }).compile();

    service = module.get<FieldDeletingService>(FieldDeletingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
