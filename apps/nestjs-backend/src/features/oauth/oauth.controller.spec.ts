import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { GlobalModule } from '../../global/global.module';
import { OAuthController } from './oauth.controller';
import { OAuthModule } from './oauth.module';

describe('OauthController', () => {
  let controller: OAuthController;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, OAuthModule],
      controllers: [OAuthController],
    }).compile();

    controller = module.get<OAuthController>(OAuthController);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
