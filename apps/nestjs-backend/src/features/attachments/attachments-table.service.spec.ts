import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AttachmentsTableService } from './attachments-table.service';

describe('AttachmentsService', () => {
  let service: AttachmentsTableService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttachmentsTableService],
    }).compile();

    service = module.get<AttachmentsTableService>(AttachmentsTableService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
