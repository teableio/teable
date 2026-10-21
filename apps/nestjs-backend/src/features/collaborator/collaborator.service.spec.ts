import { EventEmitter2 } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { APP_ROBOT_ID, Role, getPermissions } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { Events } from '../../event-emitter/events';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { CollaboratorModule } from './collaborator.module';
import { CollaboratorService } from './collaborator.service';

describe('CollaboratorService', () => {
  const mockUser = { id: 'usr1', name: 'John', email: 'john@example.com' };
  const mockSpace = { id: 'spcxxxxxxxx', name: 'Test Space' };
  const robotCollaborators = [{ principalId: APP_ROBOT_ID, principalType: PrincipalType.User }];
  const prismaService = mockDeep<PrismaService>();

  let collaboratorService: CollaboratorService;
  let clsService: ClsService<IClsStore>;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [CollaboratorModule, GlobalModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .compile();

    clsService = module.get<ClsService<IClsStore>>(ClsService);
    collaboratorService = module.get<CollaboratorService>(CollaboratorService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

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
      ).rejects.toThrow('Collaborator has already existed in space');
    });
  });

  it.each([
    [
      'space',
      () =>
        collaboratorService.createSpaceCollaborator({
          collaborators: robotCollaborators,
          role: Role.Owner,
          spaceId: mockSpace.id,
        }),
    ],
    [
      'base',
      () =>
        collaboratorService.createBaseCollaborator({
          collaborators: robotCollaborators,
          role: Role.Creator,
          baseId: 'bsexxxxxxxx',
        }),
    ],
  ])('should reject robot principals on %s collaborators', async (_name, call) => {
    await expect(call()).rejects.toThrow('Robot identities cannot be collaborators');
  });

  describe('space collaborator audit', () => {
    const invitee = { principalId: 'usr2', principalType: PrincipalType.User };
    let emitAsync: MockInstance;

    const auditRows = () =>
      emitAsync.mock.calls
        .filter(([event]) => event === Events.AUDIT_LOG_EMIT)
        .map(([, row]) => row);

    const runAsOwner = <T>(fn: () => Promise<T>) =>
      clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(Role.Owner),
          origin: { ip: '127.0.0.1', byApi: false, userAgent: 'test', referer: 'test' },
        },
        fn
      );

    beforeEach(() => {
      emitAsync = vi.spyOn(eventEmitter, 'emitAsync').mockResolvedValue([]);
      emitAsync.mockClear();
      // getOperatorCollaborators: the acting owner and the target member.
      prismaService.collaborator.findMany.mockResolvedValue([
        { principalId: mockUser.id, roleName: Role.Owner },
        { principalId: invitee.principalId, roleName: Role.Editor },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
      // isUniqueOwnerUser: two owners, so nobody is the only one.
      prismaService.$queryRawUnsafe.mockResolvedValue([
        { principal_id: mockUser.id },
        { principal_id: 'usr3' },
      ]);
    });

    it('writes space.collaborator.create with role and principals', async () => {
      prismaService.collaborator.count.mockResolvedValue(0);
      prismaService.base.findMany.mockResolvedValue([]);

      await runAsOwner(() =>
        collaboratorService.createSpaceCollaborator({
          collaborators: [invitee],
          role: Role.Editor,
          spaceId: mockSpace.id,
        })
      );

      expect(auditRows()).toEqual([
        expect.objectContaining({
          action: Events.SPACE_COLLABORATOR_CREATE,
          resourceId: mockSpace.id,
          userId: mockUser.id,
          params: { spaceId: mockSpace.id, role: Role.Editor, collaborators: [invitee] },
        }),
      ]);
    });

    it('attributes an auto-join without a signed-in user to the joining principal', async () => {
      prismaService.collaborator.count.mockResolvedValue(0);
      prismaService.base.findMany.mockResolvedValue([]);

      await clsService.runWith({} as IClsStore, () =>
        collaboratorService.createSpaceCollaborator({
          collaborators: [invitee],
          role: Role.Viewer,
          spaceId: mockSpace.id,
          createdBy: invitee.principalId,
        })
      );

      expect(auditRows()).toEqual([
        expect.objectContaining({
          action: Events.SPACE_COLLABORATOR_CREATE,
          userId: invitee.principalId,
        }),
      ]);
    });

    it('does not audit the owner row written by space creation', async () => {
      prismaService.collaborator.count.mockResolvedValue(0);
      prismaService.base.findMany.mockResolvedValue([]);

      await runAsOwner(() =>
        collaboratorService.createSpaceCollaborator({
          collaborators: [{ principalId: mockUser.id, principalType: PrincipalType.User }],
          role: Role.Owner,
          spaceId: mockSpace.id,
          skipAudit: true,
        })
      );

      expect(prismaService.collaborator.createMany).toBeCalled();
      expect(auditRows()).toEqual([]);
    });

    it('writes space.collaborator.update with oldRole and newRole', async () => {
      prismaService.collaborator.updateMany.mockResolvedValue({ count: 1 });

      await runAsOwner(() =>
        collaboratorService.updateCollaborator({
          ...invitee,
          role: Role.Owner,
          resourceId: mockSpace.id,
          resourceType: CollaboratorType.Space,
        })
      );

      expect(auditRows()).toEqual([
        expect.objectContaining({
          action: Events.SPACE_COLLABORATOR_UPDATE,
          resourceId: mockSpace.id,
          params: {
            spaceId: mockSpace.id,
            ...invitee,
            oldRole: Role.Editor,
            newRole: Role.Owner,
          },
        }),
      ]);
    });

    it('does not audit a same-role space update', async () => {
      prismaService.collaborator.updateMany.mockResolvedValue({ count: 1 });

      await runAsOwner(() =>
        collaboratorService.updateCollaborator({
          ...invitee,
          role: Role.Editor,
          resourceId: mockSpace.id,
          resourceType: CollaboratorType.Space,
        })
      );

      expect(prismaService.collaborator.updateMany).toBeCalled();
      expect(auditRows()).toEqual([]);
    });

    it('writes space.collaborator.delete with the removed role', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prismaService.collaborator.delete.mockResolvedValue({} as any);

      await runAsOwner(() =>
        collaboratorService.deleteCollaborator({
          ...invitee,
          resourceId: mockSpace.id,
          resourceType: CollaboratorType.Space,
        })
      );

      expect(auditRows()).toEqual([
        expect.objectContaining({
          action: Events.SPACE_COLLABORATOR_DELETE,
          resourceId: mockSpace.id,
          params: { spaceId: mockSpace.id, ...invitee, oldRole: Role.Editor },
        }),
      ]);
    });
  });

  // pentest RACE-01/02: the checks run on what the database holds after the space lock.
  describe('space collaborator lock', () => {
    const owner = { principalId: mockUser.id, principalType: PrincipalType.User };
    let emitAsync: MockInstance;

    const runAsOwner = <T>(fn: () => Promise<T>) =>
      clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(Role.Owner),
          origin: { ip: '127.0.0.1', byApi: false, userAgent: 'test', referer: 'test' },
        },
        fn
      );

    const lockedSpaceIds = () => prismaService.$queryRaw.mock.calls.map((call) => call[1]);

    beforeEach(() => {
      vi.clearAllMocks();
      emitAsync = vi.spyOn(eventEmitter, 'emitAsync').mockResolvedValue([]);
      prismaService.collaborator.findMany.mockResolvedValue([
        { principalId: mockUser.id, roleName: Role.Owner },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
      // isUniqueOwnerUser: the acting user is the space's only owner.
      prismaService.$queryRawUnsafe.mockResolvedValue([{ principal_id: mockUser.id }]);
    });

    it.each<[string, () => Promise<unknown>, string]>([
      [
        'removing',
        () =>
          collaboratorService.deleteCollaborator({
            ...owner,
            resourceId: mockSpace.id,
            resourceType: CollaboratorType.Space,
          }),
        'Cannot delete the only owner of the space',
      ],
      [
        'demoting',
        () =>
          collaboratorService.updateCollaborator({
            ...owner,
            role: Role.Editor,
            resourceId: mockSpace.id,
            resourceType: CollaboratorType.Space,
          }),
        'Cannot change the role of the only owner of the space',
      ],
    ])('refuses %s the only owner, counted after locking the space', async (_, run, message) => {
      await expect(runAsOwner(run)).rejects.toThrow(message);

      expect(lockedSpaceIds()).toEqual([mockSpace.id]);
      expect(prismaService.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prismaService.$queryRawUnsafe.mock.invocationCallOrder[0]
      );
      expect(prismaService.collaborator.delete).not.toBeCalled();
      expect(prismaService.collaborator.updateMany).not.toBeCalled();
    });

    it('locks the space a base collaborator change belongs to', async () => {
      prismaService.base.findUniqueOrThrow.mockResolvedValue({
        spaceId: mockSpace.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      prismaService.collaborator.findMany.mockResolvedValue([
        { principalId: mockUser.id, roleName: Role.Owner },
        { principalId: 'usr2', roleName: Role.Editor },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
      prismaService.collaborator.updateMany.mockResolvedValue({ count: 1 });

      await runAsOwner(() =>
        collaboratorService.updateCollaborator({
          principalId: 'usr2',
          principalType: PrincipalType.User,
          role: Role.Viewer,
          resourceId: 'bsexxxxxxxx',
          resourceType: CollaboratorType.Base,
        })
      );

      expect(lockedSpaceIds()).toEqual([mockSpace.id]);
      expect(prismaService.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prismaService.collaborator.findMany.mock.invocationCallOrder[0]
      );
    });

    it('emits the collaborator event only after the transaction commits', async () => {
      let committed = false;
      prismaService.$tx.mockImplementation(async (fn) => {
        const result = await fn(prismaService);
        committed = true;
        return result;
      });
      prismaService.$queryRawUnsafe.mockResolvedValue([
        { principal_id: mockUser.id },
        { principal_id: 'usr3' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prismaService.collaborator.delete.mockResolvedValue({} as any);
      const committedAtEmit: boolean[] = [];
      emitAsync.mockImplementation(async (event) => {
        if (event === Events.COLLABORATOR_DELETE) committedAtEmit.push(committed);
        return [];
      });

      await runAsOwner(() =>
        collaboratorService.deleteCollaborator({
          ...owner,
          resourceId: mockSpace.id,
          resourceType: CollaboratorType.Space,
        })
      );

      expect(committedAtEmit).toEqual([true]);
    });
  });
});
