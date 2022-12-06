import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { TableService } from './table.service';

describe('TableService', () => {
  let service: TableService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TableService],
    }).compile();

    service = module.get<TableService>(TableService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
