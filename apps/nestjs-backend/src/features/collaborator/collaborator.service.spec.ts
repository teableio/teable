import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { Role, getPermissions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { mockDeep } from 'vitest-mock-extended';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { CollaboratorModule } from './collaborator.module';
import { CollaboratorService } from './collaborator.service';

describe('CollaboratorService', () => {
  const mockUser = { id: 'usr1', name: 'John', email: 'john@example.com' };
  const mockSpace = { id: 'spcxxxxxxxx', name: 'Test Space' };
  const prismaService = mockDeep<PrismaService>();

  let collaboratorService: CollaboratorService;
  let clsService: ClsService<IClsStore>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [CollaboratorModule, GlobalModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .compile();

    clsService = module.get<ClsService<IClsStore>>(ClsService);
    collaboratorService = module.get<CollaboratorService>(CollaboratorService);

    prismaService.txClient.mockImplementation(() => {
      return prismaService;
    });

    prismaService.$tx.mockImplementation(async (fn, _options) => {
      return await fn(prismaService);
    });
  });

  describe('createSpaceCollaborator', () => {
    it('should create collaborator correctly', async () => {
      prismaService.collaborator.count.mockResolvedValue(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prismaService.base.findMany.mockResolvedValue([{ id: 'base1' }] as any);
      prismaService.collaborator.deleteMany.mockResolvedValue({ count: 0 });
      await clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(Role.Owner),
          origin: {
            ip: '127.0.0.1',
            byApi: false,
            userAgent: 'test',
            referer: 'test',
          },
        },
        async () => {
          await collaboratorService.createSpaceCollaborator({
            collaborators: [
              {
                principalId: mockUser.id,
                principalType: PrincipalType.User,
              },
            ],
            role: Role.Owner,
            spaceId: mockSpace.id,
          });
        }
      );

      expect(prismaService.collaborator.deleteMany).toBeCalledWith({
        where: {
          OR: [
            {
              principalId: mockUser.id,
              principalType: PrincipalType.User,
            },
          ],
          resourceId: { in: ['base1'] },
          resourceType: CollaboratorType.Base,
        },
      });
      expect(prismaService.collaborator.createMany).toBeCalled();
    });

    it('should throw error if exists', async () => {
      prismaService.collaborator.count.mockResolvedValue(1);

      await expect(
        collaboratorService.createSpaceCollaborator({
          collaborators: [
            {
              principalId: mockUser.id,
              principalType: PrincipalType.User,
            },
          ],
          role: Role.Owner,
          spaceId: mockSpace.id,
        })
      ).rejects.toThrow('has already existed in space');
    });
  });
});
