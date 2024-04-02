/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getPermissions, SpaceRole } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { generateInvitationCode } from '../../utils/code-generate';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { InvitationModule } from './invitation.module';
import { InvitationService } from './invitation.service';

const mockInvitationId = 'invxxxxxxxxx';
const mockInvitationCode = generateInvitationCode(mockInvitationId);

describe('InvitationService', () => {
  const prismaService = mockDeep<PrismaService>();
  const mailSenderService = mockDeep<MailSenderService>();
  const collaboratorService = mockDeep<CollaboratorService>();

  let invitationService: InvitationService;
  let clsService: ClsService<IClsStore>;

  const mockUser = { id: 'usr1', name: 'John', email: 'john@example.com' };
  const mockSpace = { id: 'spcxxxxxxxx', name: 'Test Space' };
  const mockInvitedUser = { id: 'usr2', name: 'Bob', email: 'bob@example.com' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [InvitationModule, GlobalModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .overrideProvider(MailSenderService)
      .useValue(mailSenderService)
      .overrideProvider(CollaboratorService)
      .useValue(collaboratorService)
      .compile();

    clsService = module.get<ClsService<IClsStore>>(ClsService);
    invitationService = module.get<InvitationService>(InvitationService);

    prismaService.txClient.mockImplementation(() => {
      return prismaService;
    });

    prismaService.$tx.mockImplementation(async (fn, _options) => {
      return await fn(prismaService);
    });
  });

  afterEach(() => {
    mockReset(prismaService);
  });

  it('generateInvitationBySpace', async () => {
    await clsService.runWith(
      {
        user: mockUser,
        tx: {},
        permissions: getPermissions(SpaceRole.Owner),
      },
      async () => {
        await invitationService.generateInvitationBySpace('link', mockSpace.id, {
          role: SpaceRole.Owner,
        });
      }
    );

    expect(prismaService.invitation.create).toHaveBeenCalledWith({
      data: {
        id: expect.anything(),
        invitationCode: expect.anything(),
        spaceId: mockSpace.id,
        role: SpaceRole.Owner,
        type: 'link',
        expiredTime: null,
        createdBy: mockUser.id,
      },
    });
  });

  describe('emailInvitationBySpace', () => {
    it('should throw error if space not found', async () => {
      prismaService.space.findFirst.mockResolvedValue(null);

      await expect(
        invitationService.emailInvitationBySpace(mockSpace.id, {
          emails: ['notfound@example.com'],
          role: SpaceRole.Owner,
        })
      ).rejects.toThrow('Space not found');
    });

    it('should throw error if emails empty', async () => {
      prismaService.user.findMany.mockResolvedValue([]);
      prismaService.space.findFirst.mockResolvedValue(mockSpace as any);

      await expect(
        invitationService.emailInvitationBySpace(mockSpace.id, {
          emails: [],
          role: SpaceRole.Viewer,
        })
      ).rejects.toThrow('Email not exist');
    });

    it('should send invitation email correctly', async () => {
      // mock data
      prismaService.space.findFirst.mockResolvedValue(mockSpace as any);
      prismaService.user.findMany.mockResolvedValue([mockInvitedUser as any]);
      vi.spyOn(invitationService, 'generateInvitationBySpace').mockResolvedValue({
        id: mockInvitationId,
        invitationCode: mockInvitationCode,
      } as any);

      const result = await clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () =>
          await invitationService.emailInvitationBySpace(mockSpace.id, {
            emails: [mockInvitedUser.email],
            role: SpaceRole.Owner,
          })
      );

      expect(collaboratorService.createSpaceCollaborator).toHaveBeenCalledWith(
        mockInvitedUser.id,
        mockSpace.id,
        SpaceRole.Owner
      );
      expect(prismaService.invitationRecord.create).toHaveBeenCalledWith({
        data: {
          inviter: mockUser.id,
          accepter: mockInvitedUser.id,
          type: 'email',
          spaceId: mockSpace.id,
          invitationId: mockInvitationId,
        },
      });
      expect(mailSenderService.sendMail).toHaveBeenCalled();
      expect(result).toEqual({ [mockInvitedUser.email]: { invitationId: mockInvitationId } });
    });

    it('should rollback when tx fails', async () => {
      prismaService.space.findFirst.mockResolvedValue(mockSpace as any);
      prismaService.user.findMany.mockResolvedValue([mockInvitedUser as any]);
      prismaService.$tx.mockRejectedValue(new Error('tx error'));

      await expect(
        invitationService.emailInvitationBySpace(mockSpace.id, {
          emails: [mockInvitedUser.email],
          role: SpaceRole.Owner,
        })
      ).rejects.toThrow('tx error');
    });
  });

  describe('acceptInvitationLink', () => {
    const acceptInvitationLinkRo = {
      invitationCode: mockInvitationCode,
      invitationId: mockInvitationId,
    };

    it('should throw BadRequestException for invalid code', async () => {
      const errorAcceptInvitationLinkRo = {
        invitationCode: generateInvitationCode('xxxxx'),
        invitationId: mockInvitationId,
      };

      await clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () =>
          await expect(() =>
            invitationService.acceptInvitationLink(errorAcceptInvitationLinkRo)
          ).rejects.toThrow(BadRequestException)
      );
    });
    it('should throw NotFoundException for not found link invitation', async () => {
      prismaService.invitation.findFirst.mockResolvedValue(null);

      await clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () =>
          await expect(() =>
            invitationService.acceptInvitationLink(acceptInvitationLinkRo)
          ).rejects.toThrow(NotFoundException)
      );
    });
    it('should throw ForbiddenException for expired link', async () => {
      prismaService.invitation.findFirst.mockResolvedValue({
        id: mockInvitationId,
        invitationCode: mockInvitationCode,
        type: 'link',
        expiredTime: new Date('2022-01-01'),
        spaceId: mockSpace.id,
        baseId: null,
        deletedTime: null,
        createdTime: new Date('2022-01-02'),
        role: SpaceRole.Owner,
        createdBy: mockUser.id,
        lastModifiedBy: null,
        lastModifiedTime: null,
      });
      await clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () =>
          await expect(() =>
            invitationService.acceptInvitationLink(acceptInvitationLinkRo)
          ).rejects.toThrow(ForbiddenException)
      );
    });
    it('should return success for email', async () => {
      prismaService.invitation.findFirst.mockResolvedValue({
        id: mockInvitationId,
        invitationCode: mockInvitationCode,
        type: 'email',
        expiredTime: null,
        spaceId: mockSpace.id,
        baseId: null,
        deletedTime: null,
        createdTime: new Date(),
        role: SpaceRole.Owner,
        createdBy: mockUser.id,
        lastModifiedBy: null,
        lastModifiedTime: null,
      });
      prismaService.collaborator.count.mockImplementation(() => Promise.resolve(0) as any);
      await clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () => await invitationService.acceptInvitationLink(acceptInvitationLinkRo)
      );
      expect(prismaService.collaborator.count).toHaveBeenCalledTimes(0);
    });
    it('exist collaborator', async () => {
      prismaService.invitation.findFirst.mockResolvedValue({ spaceId: mockSpace.id } as any);
      prismaService.collaborator.count.mockResolvedValue(1);
      const result = await clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () => await invitationService.acceptInvitationLink(acceptInvitationLinkRo)
      );
      expect(result.spaceId).toEqual(mockSpace.id);
    });
    it('should create collaborator and invitation record', async () => {
      const mockInvitation = {
        id: mockInvitationId,
        invitationCode: mockInvitationCode,
        type: 'link',
        expiredTime: null,
        spaceId: mockSpace.id,
        baseId: null,
        deletedTime: null,
        createdTime: new Date('2022-01-02'),
        role: SpaceRole.Owner,
        createdBy: 'createdBy',
        lastModifiedBy: null,
        lastModifiedTime: null,
      };
      prismaService.invitation.findFirst.mockResolvedValue(mockInvitation);
      prismaService.collaborator.count.mockResolvedValue(0);

      const result = await clsService.runWith(
        {
          user: mockUser,
          tx: {},
          permissions: getPermissions(SpaceRole.Owner),
        },
        async () => await invitationService.acceptInvitationLink(acceptInvitationLinkRo)
      );

      expect(prismaService.invitationRecord.create).toHaveBeenCalledWith({
        data: {
          invitationId: mockInvitation.id,
          inviter: mockInvitation.createdBy,
          accepter: mockUser.id,
          type: mockInvitation.type,
          spaceId: mockInvitation.spaceId,
          baseId: mockInvitation.baseId,
        },
      });
      expect(prismaService.collaborator.create).toHaveBeenCalledWith({
        data: {
          spaceId: mockInvitation.spaceId,
          baseId: mockInvitation.baseId,
          roleName: mockInvitation.role,
          userId: mockUser.id,
          createdBy: mockInvitation.createdBy,
        },
      });
      expect(result.spaceId).toEqual(mockInvitation.spaceId);
    });
  });
});
