import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SpaceRole } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { mockDeep } from 'jest-mock-extended';
import { ClsService } from 'nestjs-cls';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { CollaboratorModule } from './collaborator.module';
import { CollaboratorService } from './collaborator.service';

describe('CollaboratorService', () => {
  const mockUser = { id: 'usr1', name: 'John', email: 'john@example.com' };
  const mockSpace = { id: 'spcxxxxxxxx', name: 'Test Space' };
  const prismaService = mockDeep<PrismaService>();

  let clsService: ClsService<IClsStore>;
  let collaboratorService: CollaboratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [CollaboratorModule, GlobalModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .compile();

    clsService = module.get<ClsService<IClsStore>>(ClsService);
    collaboratorService = module.get<CollaboratorService>(CollaboratorService);

    clsService.enter();
    clsService.set('user', mockUser);

    prismaService.txClient.mockImplementation(() => {
      return prismaService;
    });
  });

  describe('createSpaceCollaborator', () => {
    it('should create collaborator correctly', async () => {
      prismaService.collaborator.count.mockResolvedValue(0);

      await collaboratorService.createSpaceCollaborator(mockUser.id, mockSpace.id, SpaceRole.Owner);

      expect(prismaService.collaborator.create).toBeCalledWith({
        data: {
          spaceId: mockSpace.id,
          roleName: SpaceRole.Owner,
          userId: mockUser.id,
        },
      });
    });

    it('should throw error if exists', async () => {
      prismaService.collaborator.count.mockResolvedValue(1);

      await expect(
        collaboratorService.createSpaceCollaborator(mockUser.id, mockSpace.id, SpaceRole.Owner)
      ).rejects.toThrow('has already existed in space');
    });
  });
});
