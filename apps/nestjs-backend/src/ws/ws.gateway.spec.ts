import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ShareDbService } from '../share-db/share-db.service';
import { WsGateway } from './ws.gateway';

describe('WSGateway', () => {
  let service: WsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WsGateway],
    })
      .useMocker((token) => {
        if (token === ShareDbService) {
          return jest.fn();
        }
      })
      .compile();

    service = module.get<WsGateway>(WsGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
