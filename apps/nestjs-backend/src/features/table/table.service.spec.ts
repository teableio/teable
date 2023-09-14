import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { TableModule } from './table.module';
import { TableService } from './table.service';

describe('TableService', () => {
  let service: TableService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TableModule],
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

    service = module.get<TableService>(TableService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should convert table name to valid db table name', () => {
    const dbTableName = service.generateValidDbTableName('!@#$_a ha3ha 中文');
    expect(dbTableName).toBe('visual__aha3ha');
  });

  it('should limit table name to 10', () => {
    const dbTableName = service.generateValidDbTableName('!@#$_a haha long long test for mr 中文');
    expect(dbTableName).toBe('visual__ahahalong');
  });

  it('should convert empty table name unnamed', () => {
    const dbTableName = service.generateValidDbTableName('中文');
    expect(dbTableName).toBe('visual_unnamed');
  });
});
