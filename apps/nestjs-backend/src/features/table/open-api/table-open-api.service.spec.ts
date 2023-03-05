import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { TableOpenApiService } from './table-open-api.service';

describe('TableOpenApiService', () => {
  let service: TableOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TableOpenApiService],
    }).compile();

    service = module.get<TableOpenApiService>(TableOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
