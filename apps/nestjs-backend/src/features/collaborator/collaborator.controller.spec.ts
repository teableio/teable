import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { CollaboratorController } from './collaborator.controller';

describe('CollaboratorController', () => {
  let controller: CollaboratorController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CollaboratorController],
    }).compile();

    controller = module.get<CollaboratorController>(CollaboratorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
