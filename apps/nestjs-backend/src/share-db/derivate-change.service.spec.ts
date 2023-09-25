import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../global/global.module';
import { DerivateChangeService } from './derivate-change.service';
import { ShareDbModule } from './share-db.module';

describe('DerivateChangeService', () => {
  let service: DerivateChangeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareDbModule],
    }).compile();

    service = module.get<DerivateChangeService>(DerivateChangeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
