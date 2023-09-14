import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { FieldConvertingService } from './field-converting.service';
import { FieldOpenApiModule } from './field-open-api.module';

describe('FieldConvertingService', () => {
  let service: FieldConvertingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [FieldOpenApiModule],
    })
      .useMocker((token) => {
        if (token === ClsService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<FieldConvertingService>(FieldConvertingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
