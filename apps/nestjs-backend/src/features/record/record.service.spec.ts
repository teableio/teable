import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { RecordModule } from './record.module';
import { RecordService } from './record.service';

describe('RecordService', () => {
  let service: RecordService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, RecordModule],
    }).compile();

    service = module.get<RecordService>(RecordService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
