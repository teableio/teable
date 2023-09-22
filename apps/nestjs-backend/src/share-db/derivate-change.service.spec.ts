import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@teable-group/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbModule } from './share-db.module';

describe('DerivateChangeService', () => {
  let service: DerivateChangeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ShareDbModule],
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

    service = module.get<DerivateChangeService>(DerivateChangeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
