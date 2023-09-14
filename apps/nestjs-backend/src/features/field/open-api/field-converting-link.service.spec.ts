import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { FieldConvertingLinkService } from './field-converting-link.service';
import { FieldOpenApiModule } from './field-open-api.module';

describe('FieldConvertingLinkService', () => {
  let service: FieldConvertingLinkService;

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

    service = module.get<FieldConvertingLinkService>(FieldConvertingLinkService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
