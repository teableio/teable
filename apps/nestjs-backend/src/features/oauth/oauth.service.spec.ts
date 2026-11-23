import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { OAuthModule } from './oauth.module';
import { OAuthService } from './oauth.service';

describe('OauthService', () => {
  let service: OAuthService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, OAuthModule],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
