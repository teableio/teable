import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { PluginModule } from './plugin.module';
import { PluginService } from './plugin.service';

describe('PluginService', () => {
  let service: PluginService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, PluginModule],
    }).compile();

    service = module.get<PluginService>(PluginService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
