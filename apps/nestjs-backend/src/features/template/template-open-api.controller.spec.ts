import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { TemplateOpenApiController } from './template-open-api.controller';

describe('CommentOpenApiController', () => {
  let controller: TemplateOpenApiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TemplateOpenApiController],
    }).compile();

    controller = module.get<TemplateOpenApiController>(TemplateOpenApiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
