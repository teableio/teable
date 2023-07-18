import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { LinkService } from '../features/calculation/link.service';
import { ReferenceService } from '../features/calculation/reference.service';
import { PrismaService } from '../prisma.service';
import { DerivateChangeService } from './derivate-change.service';
import { TransactionService } from './transaction.service';

describe('DerivateChangeService', () => {
  let service: DerivateChangeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DerivateChangeService,
        LinkService,
        ReferenceService,
        TransactionService,
        PrismaService,
      ],
    }).compile();

    service = module.get<DerivateChangeService>(DerivateChangeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
