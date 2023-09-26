import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SpaceCollaboratorController } from './space-collaborator.controller';

describe('SpaceCollaboratorController', () => {
  let controller: SpaceCollaboratorController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SpaceCollaboratorController],
    }).compile();

    controller = module.get<SpaceCollaboratorController>(SpaceCollaboratorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
