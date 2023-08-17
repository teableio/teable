import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { TeableEventEmitterModule } from '../../../event-emitter/event-emitter.module';
import { RecordOpenApiModule } from './record-open-api.module';
import { RecordOpenApiService } from './record-open-api.service';

describe('RecordOpenApiService', () => {
  let service: RecordOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RecordOpenApiModule, TeableEventEmitterModule.register()],
    }).compile();

    service = module.get<RecordOpenApiService>(RecordOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
