import type { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, MailTransporterType, MailType, PrincipalType } from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailSenderService } from '../../features/mail-sender/mail-sender.service';
import type { NotificationService } from '../../features/notification/notification.service';
import { generateInvitationCode } from '../../utils/code-generate';
import { CollaboratorInvitedEvent } from '../events';
import { CollaboratorInviteListener } from './collaborator-invite.listener';

describe('CollaboratorInviteListener', () => {
  let listener: CollaboratorInviteListener;
  let prismaService: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    space: { findUnique: ReturnType<typeof vi.fn> };
    base: { findUnique: ReturnType<typeof vi.fn> };
  };
  let notificationService: { sendCommonNotify: ReturnType<typeof vi.fn> };
  let mailSenderService: {
    inviteEmailOptions: ReturnType<typeof vi.fn>;
    sendMail: ReturnType<typeof vi.fn>;
    generateInviteUrl: ReturnType<typeof vi.fn>;
  };

  const createdBy = 'usrInviter';

  beforeEach(() => {
    prismaService = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ name: 'Inviter', email: 'inviter@example.com' }),
      },
      space: { findUnique: vi.fn().mockResolvedValue({ name: 'My Space' }) },
      base: { findUnique: vi.fn().mockResolvedValue({ name: 'My Base' }) },
    };
    notificationService = { sendCommonNotify: vi.fn().mockResolvedValue({ sentCount: 1 }) };
    mailSenderService = {
      inviteEmailOptions: vi.fn().mockResolvedValue({ subject: 'invite', template: 'normal' }),
      sendMail: vi.fn().mockResolvedValue(true),
      generateInviteUrl: vi.fn(
        (invitationId: string, invitationCode: string) =>
          `https://app.example.com/invite?invitationId=${invitationId}&invitationCode=${invitationCode}`
      ),
    };
    listener = new CollaboratorInviteListener(
      prismaService as unknown as PrismaService,
      notificationService as unknown as NotificationService,
      mailSenderService as unknown as MailSenderService
    );
  });

  const spaceEvent = (
    invitees: ConstructorParameters<typeof CollaboratorInvitedEvent>[3],
    skipSendMail?: boolean
  ) =>
    new CollaboratorInvitedEvent(
      'spcxxx',
      CollaboratorType.Space,
      createdBy,
      invitees,
      skipSendMail
    );

  it('does nothing when event has no invitees', async () => {
    await listener.listener(spaceEvent([]));

    expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    expect(notificationService.sendCommonNotify).not.toHaveBeenCalled();
    expect(mailSenderService.sendMail).not.toHaveBeenCalled();
  });

  it('skips department principals', async () => {
    await listener.listener(
      spaceEvent([{ principalId: 'dptxxx', principalType: PrincipalType.Department }])
    );

    expect(notificationService.sendCommonNotify).not.toHaveBeenCalled();
    expect(mailSenderService.sendMail).not.toHaveBeenCalled();
  });

  it('skips collaborators added by themselves', async () => {
    await listener.listener(
      spaceEvent([{ principalId: createdBy, principalType: PrincipalType.User }])
    );

    expect(notificationService.sendCommonNotify).not.toHaveBeenCalled();
  });

  it('does nothing when the inviter user is missing', async () => {
    prismaService.user.findUnique.mockResolvedValue(null);
    await listener.listener(
      spaceEvent([{ principalId: 'usrInvitee', principalType: PrincipalType.User }])
    );

    expect(notificationService.sendCommonNotify).not.toHaveBeenCalled();
    expect(mailSenderService.sendMail).not.toHaveBeenCalled();
  });

  it('does nothing when the resource is missing', async () => {
    prismaService.space.findUnique.mockResolvedValue(null);
    await listener.listener(
      spaceEvent([{ principalId: 'usrInvitee', principalType: PrincipalType.User }])
    );

    expect(notificationService.sendCommonNotify).not.toHaveBeenCalled();
    expect(mailSenderService.sendMail).not.toHaveBeenCalled();
  });

  it('sends a space invite notification to invited users', async () => {
    await listener.listener(
      spaceEvent([
        { principalId: 'usrInvitee', principalType: PrincipalType.User },
        { principalId: createdBy, principalType: PrincipalType.User },
        { principalId: 'dptxxx', principalType: PrincipalType.Department },
      ])
    );

    expect(notificationService.sendCommonNotify).toHaveBeenCalledWith(
      {
        path: '/space/spcxxx',
        fromUserId: createdBy,
        toUserId: ['usrInvitee'],
        message: {
          i18nKey: 'common.email.templates.notify.collaboratorInvite.space',
          context: { fromUserName: 'Inviter', resourceName: 'My Space' },
        },
        severity: 'info',
      },
      'collaboratorInvite'
    );
  });

  it('sends a base invite notification with base path and i18n key', async () => {
    const event = new CollaboratorInvitedEvent('bsexxx', CollaboratorType.Base, createdBy, [
      { principalId: 'usrInvitee', principalType: PrincipalType.User },
    ]);
    await listener.listener(event);

    expect(prismaService.base.findUnique).toHaveBeenCalledWith({
      where: { id: 'bsexxx', deletedTime: null },
      select: { name: true },
    });
    expect(notificationService.sendCommonNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/base/bsexxx',
        toUserId: ['usrInvitee'],
        message: {
          i18nKey: 'common.email.templates.notify.collaboratorInvite.base',
          context: { fromUserName: 'Inviter', resourceName: 'My Base' },
        },
      }),
      'collaboratorInvite'
    );
  });

  it('sends invite emails and notifications to every invitee, including pre-created accounts', async () => {
    await listener.listener(
      spaceEvent([
        {
          principalId: 'usrInvitee',
          principalType: PrincipalType.User,
          email: 'invitee@example.com',
          invitationId: 'invaaa',
        },
        {
          principalId: 'usrNew',
          principalType: PrincipalType.User,
          email: 'new@example.com',
          invitationId: 'invbbb',
        },
      ])
    );

    expect(mailSenderService.inviteEmailOptions).toHaveBeenCalledWith({
      name: 'Inviter',
      email: 'inviter@example.com',
      resourceName: 'My Space',
      resourceType: CollaboratorType.Space,
      inviteUrl: `https://app.example.com/invite?invitationId=invaaa&invitationCode=${generateInvitationCode('invaaa')}`,
    });
    expect(mailSenderService.sendMail).toHaveBeenCalledTimes(2);
    expect(mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'invitee@example.com' }),
      { type: MailType.Invite, transporterName: MailTransporterType.Notify }
    );
    expect(mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new@example.com' }),
      { type: MailType.Invite, transporterName: MailTransporterType.Notify }
    );
    // pre-created accounts are notified too — the unread notification is their
    // first-login trace of the invite
    expect(notificationService.sendCommonNotify).toHaveBeenCalledWith(
      expect.objectContaining({ toUserId: ['usrInvitee', 'usrNew'] }),
      'collaboratorInvite'
    );
  });

  it('skips all emails when skipSendMail is set', async () => {
    await listener.listener(
      spaceEvent(
        [
          {
            principalId: 'usrInvitee',
            principalType: PrincipalType.User,
            email: 'invitee@example.com',
            invitationId: 'invaaa',
          },
        ],
        true
      )
    );

    expect(mailSenderService.sendMail).not.toHaveBeenCalled();
    // in-app notification is unaffected by the mail shadow-ban
    expect(notificationService.sendCommonNotify).toHaveBeenCalled();
  });

  it('sends no email for invitees without an invitationId (direct add)', async () => {
    await listener.listener(
      spaceEvent([{ principalId: 'usrInvitee', principalType: PrincipalType.User }])
    );

    expect(mailSenderService.sendMail).not.toHaveBeenCalled();
    expect(notificationService.sendCommonNotify).toHaveBeenCalled();
  });

  it('keeps sending after a single invitee email fails', async () => {
    mailSenderService.inviteEmailOptions.mockRejectedValueOnce(new Error('brand lookup failed'));

    await listener.listener(
      spaceEvent([
        {
          principalId: 'usrA',
          principalType: PrincipalType.User,
          email: 'a@example.com',
          invitationId: 'invaaa',
        },
        {
          principalId: 'usrB',
          principalType: PrincipalType.User,
          email: 'b@example.com',
          invitationId: 'invbbb',
        },
      ])
    );

    expect(mailSenderService.sendMail).toHaveBeenCalledTimes(1);
    expect(mailSenderService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'b@example.com' }),
      { type: MailType.Invite, transporterName: MailTransporterType.Notify }
    );
  });
});
