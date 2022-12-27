import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { WsGateway } from './ws.gateway';

describe('WSGateway', () => {
  let service: WsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WsGateway],
    }).compile();

    service = module.get<WsGateway>(WsGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
