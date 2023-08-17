import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { TeableEventEmitterModule } from '../event-emitter/event-emitter.module';
import { ShareDbModule } from '../share-db/share-db.module';
import { WsGateway } from './ws.gateway';

describe('WSGateway', () => {
  let service: WsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ShareDbModule, TeableEventEmitterModule.register()],
      providers: [WsGateway, ConfigService],
    }).compile();

    service = module.get<WsGateway>(WsGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
