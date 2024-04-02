import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AccessTokenController } from './access-token.controller';

describe('AccessTokenController', () => {
  let controller: AccessTokenController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccessTokenController],
    }).compile();

    controller = module.get<AccessTokenController>(AccessTokenController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
