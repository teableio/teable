/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SpaceRole, getPermissions } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { mockDeep, mockReset } from 'jest-mock-extended';
import { ClsService } from 'nestjs-cls';
import { GlobalModule } from '../../global/global.module';
import type { IClsStore } from '../../types/cls';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { InvitationModule } from './invitation.module';
import { InvitationService } from './invitation.service';

const mockInvitationId = 'invxxxxxxxxx';
const mockInvitationCode = 'mockInvitationCode';

jest.mock('@teable-group/core', () => {
  const originalModule = jest.requireActual('@teable-group/core');
  return {
    __esModule: true,
    ...originalModule,
    generateInvitationId: () => mockInvitationId,
    generateInvitationCode: () => mockInvitationCode,
  };
});

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
        id: mockInvitationId,
        invitationCode: mockInvitationCode,
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
      jest
        .spyOn(invitationService, 'generateInvitationBySpace')
        .mockResolvedValue({ id: mockInvitationId, invitationCode: mockInvitationCode } as any);
      jest
        .spyOn(invitationService as any, 'spaceEmailOptions')
        .mockResolvedValue({ title: '', content: '' });

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

      expect(collaboratorService.createSpaceCollaborator).toBeCalledWith(
        mockInvitedUser.id,
        mockSpace.id,
        SpaceRole.Owner
      );
      expect(mailSenderService.sendMail).toBeCalled();
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
});
