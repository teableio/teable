import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { ViewOpenApiModule } from './view-open-api.module';
import { ViewOpenApiService } from './view-open-api.service';

describe('ViewOpenApiService', () => {
  let service: ViewOpenApiService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, ViewOpenApiModule],
    }).compile();

    service = module.get<ViewOpenApiService>(ViewOpenApiService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
