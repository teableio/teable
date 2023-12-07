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
    const dbTableName = service.generateValidName('!@#$1_a ha3ha 中文');
    expect(dbTableName).toBe('t1_a_ha3ha_Zhong_Wen');
  });

  it('should limit table name to 40', () => {
    const dbTableName = service.generateValidName('t'.repeat(50));
    expect(dbTableName).toBe('t'.repeat(40));
  });

  it('should convert chinese to pin yin', () => {
    const dbTableName = service.generateValidName('中文');
    expect(dbTableName).toBe('Zhong_Wen');
  });

  it('should convert empty table name unnamed', () => {
    const dbTableName = service.generateValidName('');
    expect(dbTableName).toBe('unnamed');
  });
});
