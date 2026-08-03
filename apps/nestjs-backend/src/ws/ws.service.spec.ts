import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { WsService } from './ws.service';

describe('WsService', () => {
  let service: WsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WsService],
    }).compile();

    service = module.get<WsService>(WsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
