/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { FieldOpenApiModule } from './field-open-api.module';
import { FieldOpenApiService } from './field-open-api.service';

describe('FieldOpenApiService', () => {
  let service: FieldOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, FieldOpenApiModule],
    }).compile();

    service = module.get<FieldOpenApiService>(FieldOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
