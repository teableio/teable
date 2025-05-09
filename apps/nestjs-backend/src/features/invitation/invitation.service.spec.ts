/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getPermissions, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
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
  const defaultCls = {
    user: mockUser,
    tx: {},
    origin: {
      ip: '127.0.0.1',
      byApi: false,
      userAgent: 'test',
      referer: 'test',
    },
  };
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

  it('generateInvitation', async () => {
    await clsService.runWith(
      {
        ...defaultCls,
        permissions: getPermissions(Role.Owner),
      },
      async () => {
        await invitationService['generateInvitation']({
          resourceId: mockSpace.id,
          resourceType: CollaboratorType.Space,
          role: Role.Owner,
          type: 'link',
        });
      }
    );

    expect(prismaService.invitation.create).toHaveBeenCalledWith({
      data: {
        id: expect.anything(),
        invitationCode: expect.anything(),
        spaceId: mockSpace.id,
        role: Role.Owner,
        baseId: null,
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
          role: Role.Owner,
        })
      ).rejects.toThrow('Space not found');
    });

    it('should send invitation email correctly', async () => {
      // mock data
      prismaService.space.findFirst.mockResolvedValue(mockSpace as any);
      prismaService.user.findMany.mockResolvedValue([mockInvitedUser as any]);
      vi.spyOn(invitationService as any, 'generateInvitation').mockResolvedValue({
        id: mockInvitationId,
        invitationCode: mockInvitationCode,
      } as any);
      collaboratorService.validateUserAddRole.mockResolvedValue();

      const result = await clsService.runWith(
        {
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
        },
        async () =>
          await invitationService.emailInvitationBySpace(mockSpace.id, {
            emails: [mockInvitedUser.email],
            role: Role.Owner,
          })
      );

      expect(collaboratorService.createSpaceCollaborator).toHaveBeenCalledWith({
        collaborators: [
          {
            principalId: mockInvitedUser.id,
            principalType: PrincipalType.User,
          },
        ],
        spaceId: mockSpace.id,
        role: Role.Owner,
      });

      expect(prismaService.invitationRecord.create).toHaveBeenCalledWith({
        data: {
          inviter: mockUser.id,
          accepter: mockInvitedUser.id,
          type: 'email',
          baseId: null,
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
      collaboratorService.validateUserAddRole.mockResolvedValue();
      vi.spyOn(invitationService as any, 'checkSpaceInvitation').mockResolvedValue(true);

      await clsService.runWith(
        {
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
        },
        async () => {
          await expect(
            invitationService.emailInvitationBySpace(mockSpace.id, {
              emails: [mockInvitedUser.email],
              role: Role.Owner,
            })
          ).rejects.toThrow('tx error');
        }
      );
    });
  });

  describe('emailInvitationByBase', () => {
    it('should throw error if base not found', async () => {
      prismaService.base.findFirst.mockResolvedValue(null);

      await expect(
        invitationService.emailInvitationByBase('base1', {
          emails: ['notfound@example.com'],
          role: Role.Creator,
        })
      ).rejects.toThrow('Base not found');
    });

    it('should send invitation email correctly', async () => {
      // mock data
      prismaService.base.findFirst.mockResolvedValue({ id: 'base1' } as any);
      prismaService.user.findMany.mockResolvedValue([mockInvitedUser as any]);
      vi.spyOn(invitationService as any, 'generateInvitation').mockResolvedValue({
        id: mockInvitationId,
        invitationCode: mockInvitationCode,
      } as any);
      collaboratorService.validateUserAddRole.mockResolvedValue();

      const result = await clsService.runWith(
        {
          ...defaultCls,
          permissions: getPermissions(Role.Creator),
        },
        async () =>
          await invitationService.emailInvitationByBase('base1', {
            emails: [mockInvitedUser.email],
            role: Role.Creator,
          })
      );

      expect(collaboratorService.createBaseCollaborator).toHaveBeenCalledWith({
        collaborators: [
          {
            principalId: mockInvitedUser.id,
            principalType: PrincipalType.User,
          },
        ],
        baseId: 'base1',
        role: Role.Creator,
      });
      expect(prismaService.invitationRecord.create).toHaveBeenCalledWith({
        data: {
          inviter: mockUser.id,
          accepter: mockInvitedUser.id,
          type: 'email',
          baseId: 'base1',
          spaceId: null,
          invitationId: mockInvitationId,
        },
      });
      expect(mailSenderService.sendMail).toHaveBeenCalled();
      expect(result).toEqual({ [mockInvitedUser.email]: { invitationId: mockInvitationId } });
    });

    it('should rollback when tx fails', async () => {
      prismaService.base.findFirst.mockResolvedValue({ id: 'base1' } as any);
      prismaService.user.findMany.mockResolvedValue([mockInvitedUser as any]);
      prismaService.$tx.mockRejectedValue(new Error('tx error'));
      collaboratorService.validateUserAddRole.mockResolvedValue();
      vi.spyOn(invitationService as any, 'checkSpaceInvitation').mockResolvedValue(true);
      await clsService.runWith(
        {
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
          origin: {
            ip: '127.0.0.1',
            byApi: false,
            userAgent: 'test',
            referer: 'test',
          },
        },
        async () => {
          await expect(
            invitationService.emailInvitationByBase('base1', {
              emails: [mockInvitedUser.email],
              role: Role.Creator,
            })
          ).rejects.toThrow('tx error');
        }
      );
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
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
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
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
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
        role: Role.Owner,
        createdBy: mockUser.id,
        lastModifiedBy: null,
        lastModifiedTime: null,
      });
      await clsService.runWith(
        {
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
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
        role: Role.Owner,
        createdBy: mockUser.id,
        lastModifiedBy: null,
        lastModifiedTime: null,
      });
      prismaService.collaborator.count.mockImplementation(() => Promise.resolve(0) as any);
      await clsService.runWith(
        {
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
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
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
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
        role: Role.Owner,
        createdBy: 'createdBy',
        lastModifiedBy: null,
        lastModifiedTime: null,
      };
      prismaService.invitation.findFirst.mockResolvedValue(mockInvitation);
      prismaService.collaborator.count.mockResolvedValue(0);

      const result = await clsService.runWith(
        {
          ...defaultCls,
          permissions: getPermissions(Role.Owner),
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
      expect(collaboratorService.createSpaceCollaborator).toHaveBeenCalledWith({
        collaborators: [
          {
            principalId: mockUser.id,
            principalType: PrincipalType.User,
          },
        ],
        spaceId: mockSpace.id,
        role: Role.Owner,
        createdBy: 'createdBy',
      });
      expect(result.spaceId).toEqual(mockInvitation.spaceId);
    });
  });
});
