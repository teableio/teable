/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Prisma } from '../../';
import { AbstractSeed } from '../seed.abstract';
import { CREATE_USER_NUM, generateUser } from './user-seeds';

const userId = 'usrTestUserId';

const spaceId = 'spcTestSpaceId';
const spaceName = 'test space';

const baseId = 'bseTestBaseId';
const baseName = 'test base';

const collaboratorId = 'usrTestCollaboratorId';
const generateSpace = (): Prisma.SpaceCreateInput => {
  return {
    id: spaceId,
    name: spaceName,
    createdBy: userId,
    lastModifiedBy: userId,
  };
};

const generateBase = (): Prisma.BaseCreateInput => {
  return {
    id: baseId,
    name: baseName,
    order: 1,
    createdBy: userId,
    space: {
      connect: {
        id: spaceId,
      },
    },
    lastModifiedBy: userId,
  };
};

export const generateCollaborator = async (
  connectUserNum: number
): Promise<Prisma.CollaboratorCreateInput[]> => {
  const userSets = await generateUser(connectUserNum);

  return Array.from({ length: connectUserNum + 1 }, (_, i) => ({
    id: `${collaboratorId}_${i}`,
    spaceId,
    roleName: 'owner',
    userId: userSets[i].id!,
    createdBy: userSets[i].id!,
    lastModifiedBy: userSets[i].id!,
  }));
};

export class SpaceSeeds extends AbstractSeed {
  execute = async (): Promise<void> => {
    await this.prisma.$transaction(async (tx) => {
      // Space
      const { id: spaceId, ...spaceNonUnique } = generateSpace();
      const space = await tx.space.upsert({
        where: { id: spaceId },
        update: spaceNonUnique,
        create: { id: spaceId, ...spaceNonUnique },
      });
      this.log('UPSERT', `Space ${space.id} - ${space.name}`);

      // Base
      const { id: baseId, ...baseNonUnique } = generateBase();
      const base = await tx.base.upsert({
        where: { id: baseId },
        update: baseNonUnique,
        create: { id: baseId, ...baseNonUnique },
      });
      this.log('UPSERT', `Base ${base.id} - ${base.name}`);

      // Collaborator
      const collaboratorSets = await generateCollaborator(CREATE_USER_NUM);
      for (const c of collaboratorSets) {
        const { id, spaceId, userId, ...collaboratorNonUnique } = c;
        const collaborator = await this.prisma.collaborator.upsert({
          where: { id, spaceId, userId },
          update: collaboratorNonUnique,
          create: c,
        });
        this.log(
          'UPSERT',
          `Collaborator ${collaborator.id} - ${collaborator.spaceId} - ${collaborator.userId}`
        );
      }
    });
  };
}
