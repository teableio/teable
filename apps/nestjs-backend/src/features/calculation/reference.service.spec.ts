/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { CalculationModule } from './calculation.module';
import { ReferenceService } from './reference.service';

describe('ReferenceService', () => {
  let service: ReferenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, CalculationModule],
    }).compile();

    service = module.get<ReferenceService>(ReferenceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
