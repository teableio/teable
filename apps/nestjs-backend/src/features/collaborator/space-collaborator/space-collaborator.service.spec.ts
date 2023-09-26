import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SpaceCollaboratorService } from './space-collaborator.service';

describe('SpaceCollaboratorService', () => {
  let service: SpaceCollaboratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SpaceCollaboratorService],
    }).compile();

    service = module.get<SpaceCollaboratorService>(SpaceCollaboratorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
