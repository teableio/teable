import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ShareDbModule } from '../share-db/share-db.module';
import { WsGateway } from './ws.gateway';

describe('WSGateway', () => {
  let service: WsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ShareDbModule, EventEmitterModule.forRoot()],
      providers: [WsGateway, ConfigService],
    }).compile();

    service = module.get<WsGateway>(WsGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
