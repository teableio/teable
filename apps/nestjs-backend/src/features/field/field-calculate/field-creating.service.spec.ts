import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../../global/global.module';
import { FieldOpenApiModule } from '../open-api/field-open-api.module';
import { FieldCreatingService } from './field-creating.service';

describe('FieldCreatingService', () => {
  let service: FieldCreatingService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, FieldOpenApiModule],
    }).compile();

    service = module.get<FieldCreatingService>(FieldCreatingService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
