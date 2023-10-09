import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../global/global.module';
import { ShareDbModule } from '../share-db/share-db.module';
import { WsGateway } from './ws.gateway';

describe('WSGateway', () => {
  let service: WsGateway;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareDbModule],
      providers: [WsGateway],
    }).compile();

    service = module.get<WsGateway>(WsGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
