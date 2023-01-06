import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { RecordOpenApiService } from './record-open-api.service';

describe('RecordOpenApiService', () => {
  let service: RecordOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RecordOpenApiService],
    }).compile();

    service = module.get<RecordOpenApiService>(RecordOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
