import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../global/global.module';
import { ShareDbModule } from './share-db.module';
import { WsDerivateService } from './ws-derivate.service';

describe('WsDerivateService', () => {
  let service: WsDerivateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareDbModule],
    }).compile();

    service = module.get<WsDerivateService>(WsDerivateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
