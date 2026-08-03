import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { ShareModule } from './share.module';
import { ShareService } from './share.service';

describe('ShareService', () => {
  let service: ShareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareModule],
    }).compile();

    service = module.get<ShareService>(ShareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
