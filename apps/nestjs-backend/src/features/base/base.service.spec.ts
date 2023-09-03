import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { BaseModule } from './base.module';
import { BaseService } from './base.service';

describe('BaseService', () => {
  let service: BaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [BaseModule],
    })
      .useMocker((token) => {
        if (token === PrismaService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<BaseService>(BaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
