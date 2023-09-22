import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { GraphService } from './graph.service';
import { TableOpenApiModule } from './table-open-api.module';

describe('GraphServiceService', () => {
  let service: GraphService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TableOpenApiModule],
    })
      .useMocker((token) => {
        if (token === ClsService) {
          return jest.fn();
        }
        if (token === PrismaService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<GraphService>(GraphService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
