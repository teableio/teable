import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { TeableEventEmitterModule } from '../../../event-emitter/event-emitter.module';
import { RecordOpenApiModule } from './record-open-api.module';
import { RecordOpenApiService } from './record-open-api.service';

describe('RecordOpenApiService', () => {
  let service: RecordOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RecordOpenApiModule, TeableEventEmitterModule.register()],
    })
      .useMocker((token) => {
        if (token === PrismaService) {
          return jest.fn();
        }
        if (token === ClsService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<RecordOpenApiService>(RecordOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
