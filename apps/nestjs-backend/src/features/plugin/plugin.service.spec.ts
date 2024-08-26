import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PluginService } from './plugin.service';

describe('PluginService', () => {
  let service: PluginService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PluginService],
    }).compile();

    service = module.get<PluginService>(PluginService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
