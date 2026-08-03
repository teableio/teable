import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { FieldOpenApiModule } from '../open-api/field-open-api.module';
import { FieldCreatingService } from './field-creating.service';

describe('FieldCreatingService', () => {
  let service: FieldCreatingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, FieldOpenApiModule],
    }).compile();

    service = module.get<FieldCreatingService>(FieldCreatingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
