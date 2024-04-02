import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { BaseDuplicateService } from './base-duplicate.service';
import { BaseModule } from './base.module';

describe('BaseDuplicateService', () => {
  let service: BaseDuplicateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, BaseModule],
    }).compile();

    service = module.get<BaseDuplicateService>(BaseDuplicateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
