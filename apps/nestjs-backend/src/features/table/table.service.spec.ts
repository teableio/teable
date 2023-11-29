import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { TableModule } from './table.module';
import { TableService } from './table.service';

describe('TableService', () => {
  let service: TableService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, TableModule],
    }).compile();

    service = module.get<TableService>(TableService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should convert table name to valid db table name', () => {
    const dbTableName = service.generateValidName('!@#$_a ha3ha 中文');
    expect(dbTableName).toBe('_aha3ha');
  });

  it('should limit table name to 10', () => {
    const dbTableName = service.generateValidName('!@#$_a haha long long test for mr 中文');
    expect(dbTableName).toBe('_ahahalong');
  });

  it('should convert empty table name unnamed', () => {
    const dbTableName = service.generateValidName('中文');
    expect(dbTableName).toBe('unnamed');
  });
});
