import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatModule } from './chat.module';

describe('ChatController', () => {
  let controller: ChatController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      imports: [ChatModule],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
