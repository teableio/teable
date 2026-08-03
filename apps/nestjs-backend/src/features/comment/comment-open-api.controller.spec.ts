import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { CommentOpenApiController } from './comment-open-api.controller';

describe('CommentOpenApiController', () => {
  let controller: CommentOpenApiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentOpenApiController],
    }).compile();

    controller = module.get<CommentOpenApiController>(CommentOpenApiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
