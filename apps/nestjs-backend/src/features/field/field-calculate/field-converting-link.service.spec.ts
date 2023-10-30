import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { FieldOpenApiModule } from '../open-api/field-open-api.module';
import { FieldConvertingLinkService } from './field-converting-link.service';

describe('FieldConvertingLinkService', () => {
  let service: FieldConvertingLinkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, FieldOpenApiModule],
    }).compile();

    service = module.get<FieldConvertingLinkService>(FieldConvertingLinkService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
