import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { TeableEventEmitterModule } from '../../../event-emitter/event-emitter.module';
import { TableOpenApiModule } from './table-open-api.module';
import { TableOpenApiService } from './table-open-api.service';

describe('TableOpenApiService', () => {
  let service: TableOpenApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TableOpenApiModule, TeableEventEmitterModule.register()],
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

    service = module.get<TableOpenApiService>(TableOpenApiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
