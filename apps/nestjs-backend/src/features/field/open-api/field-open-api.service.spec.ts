/* eslint-disable @typescript-eslint/naming-convention */
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldOpenApiModule } from './field-open-api.module';
import { FieldOpenApiService } from './field-open-api.service';

describe('FieldOpenApiService', () => {
  let service: FieldOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [FieldOpenApiModule, EventEmitterModule.forRoot()],
    }).compile();

    service = module.get<FieldOpenApiService>(FieldOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
