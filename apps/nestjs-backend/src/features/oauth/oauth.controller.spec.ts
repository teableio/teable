import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { OAuthController } from './oauth.controller';

describe('OauthController', () => {
  let controller: OAuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController],
    }).compile();

    controller = module.get<OAuthController>(OAuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
