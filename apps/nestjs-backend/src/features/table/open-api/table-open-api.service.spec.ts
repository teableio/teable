import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { TeableEventEmitterModule } from '../../../event-emitter/event-emitter.module';
import { TableOpenApiModule } from './table-open-api.module';
import { TableOpenApiService } from './table-open-api.service';

describe('TableOpenApiService', () => {
  let service: TableOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TableOpenApiModule, TeableEventEmitterModule.register()],
    }).compile();

    service = module.get<TableOpenApiService>(TableOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
