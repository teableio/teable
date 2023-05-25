import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DerivateChangeService } from './derivate-change.service';

describe('DerivateChangeService', () => {
  let service: DerivateChangeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DerivateChangeService],
    }).compile();

    service = module.get<DerivateChangeService>(DerivateChangeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
