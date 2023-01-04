import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { RecordCommandService } from './record-command.service';

describe('RecordCommandService', () => {
  let service: RecordCommandService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RecordCommandService],
    }).compile();

    service = module.get<RecordCommandService>(RecordCommandService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
