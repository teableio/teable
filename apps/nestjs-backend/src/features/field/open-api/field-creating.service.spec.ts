import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldCreatingService } from './field-creating.service';

describe('FieldCreatingService', () => {
  let service: FieldCreatingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FieldCreatingService],
    }).compile();

    service = module.get<FieldCreatingService>(FieldCreatingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
