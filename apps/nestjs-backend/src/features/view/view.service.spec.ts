import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { ViewModule } from './view.module';
import { ViewService } from './view.service';

describe('ViewService', () => {
  let service: ViewService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, ViewModule],
    }).compile();

    service = module.get<ViewService>(ViewService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
