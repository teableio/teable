import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { ViewOpenApiModule } from './view-open-api.module';
import { ViewOpenApiService } from './view-open-api.service';

describe('ViewOpenApiService', () => {
  let service: ViewOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ViewOpenApiModule],
    }).compile();

    service = module.get<ViewOpenApiService>(ViewOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
