import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { ViewModule } from './view.module';
import { ViewService } from './view.service';

describe('ViewService', () => {
  let service: ViewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ViewModule],
    }).compile();

    service = module.get<ViewService>(ViewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
