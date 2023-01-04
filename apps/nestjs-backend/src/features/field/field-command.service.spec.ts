import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldCommandService } from './field-command.service';

describe('FieldCommandService', () => {
  let service: FieldCommandService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FieldCommandService],
    }).compile();

    service = module.get<FieldCommandService>(FieldCommandService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
