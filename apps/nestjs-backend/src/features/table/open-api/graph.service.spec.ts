import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GraphService } from './graph.service';
import { TableOpenApiModule } from './table-open-api.module';

describe('GraphServiceService', () => {
  let service: GraphService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TableOpenApiModule],
    }).compile();

    service = module.get<GraphService>(GraphService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
