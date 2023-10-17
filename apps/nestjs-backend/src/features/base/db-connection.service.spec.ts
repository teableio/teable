import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { BaseModule } from './base.module';
import { DbConnectionService } from './db-connection.service';

describe('DbConnectionService', () => {
  let service: DbConnectionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, BaseModule],
    }).compile();

    service = module.get<DbConnectionService>(DbConnectionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
