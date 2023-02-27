import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ViewOpenApiService } from './view-open-api.service';

describe('ViewOpenApiService', () => {
  let service: ViewOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ViewOpenApiService],
    }).compile();

    service = module.get<ViewOpenApiService>(ViewOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
