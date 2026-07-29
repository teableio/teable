import type { INestApplication } from '@nestjs/common';
import { NotificationTypeEnum, Role } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { CreateSpaceInvitationLinkVo, IUserMeVo } from '@teable/openapi';
import {
  ACCEPT_INVITATION_LINK,
  addBaseCollaborator,
  addSpaceCollaborator,
  createBase,
  createSpace as apiCreateSpace,
  createSpaceInvitationLink as apiCreateSpaceInvitationLink,
  deleteSpace as apiDeleteSpace,
  emailBaseInvitation,
  emailSpaceInvitation,
  getSpaceCollaboratorList as apiGetSpaceCollaboratorList,
  PrincipalType,
  USER_ME,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createAwaitWithEvent } from './utils/event-promise';
import { initApp } from './utils/init-app';

describe('OpenAPI InvitationController (e2e)', () => {
  let app: INestApplication;
  let spaceId: string;
  let user2Request: AxiosInstance;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const res = await apiCreateSpace({ name: 'new space' });
    spaceId = res.data.id;

    user2Request = await createNewUserAxios({
      email: 'newuser@example.com',
      password: '12345678',
    });
  });

  afterAll(async () => {
    await apiDeleteSpace(spaceId);
    await app.close();
  });

  it('/api/invitation/link/accept (POST)', async () => {
    const invitationLinkRes = await apiCreateSpaceInvitationLink({
      spaceId,
      createSpaceInvitationLinkRo: { role: Role.Owner },
    });

    const { invitationId, invitationCode } = invitationLinkRes.data as CreateSpaceInvitationLinkVo;
    const data = await user2Request.post(ACCEPT_INVITATION_LINK, { invitationId, invitationCode });

    expect(data.data.spaceId).toEqual(spaceId);
    const { collaborators } = (await apiGetSpaceCollaboratorList(spaceId)).data;
    const collaborator = collaborators.find(
      (item) => item.type === PrincipalType.User && item.email === 'newuser@example.com'
    );
    expect(collaborator?.role).toEqual(Role.Owner);
  });

  describe('collaborator invite notification', () => {
    let prisma: PrismaService;
    let awaitWithCollaboratorCreate: <T>(action: () => Promise<T>) => Promise<T>;
    let notifySpaceId: string;
    let notifyBaseId: string;
    let inviterName: string;
    const inviteeIds: string[] = [];

    const spaceName = 'invite notify space';
    const baseName = 'invite notify base';

    beforeAll(async () => {
      prisma = app.get(PrismaService);
      const eventEmitterService = app.get(EventEmitterService);
      awaitWithCollaboratorCreate = createAwaitWithEvent(
        eventEmitterService,
        Events.COLLABORATOR_CREATE
      );

      const spaceRes = await apiCreateSpace({ name: spaceName });
      notifySpaceId = spaceRes.data.id;
      const baseRes = await createBase({ spaceId: notifySpaceId, name: baseName });
      notifyBaseId = baseRes.data.id;

      const inviter = await prisma.user.findUniqueOrThrow({
        where: { id: globalThis.testConfig.userId },
        select: { name: true },
      });
      inviterName = inviter.name;
    });

    afterAll(async () => {
      await prisma.notification.deleteMany({ where: { toUserId: { in: inviteeIds } } });
      await apiDeleteSpace(notifySpaceId);
    });

    const createInvitee = async (email: string) => {
      const request = await createNewUserAxios({ email, password: '12345678' });
      const me = await request.get<IUserMeVo>(USER_ME);
      inviteeIds.push(me.data.id);
      return { request, userId: me.data.id, email };
    };

    // Worker databases are shared across spec files in CI, so assertions on
    // long-lived users (e.g. the seeded global user) must scope by urlPath.
    const findInviteNotifications = (toUserId: string, urlPath?: string) =>
      prisma.notification.findMany({
        where: { toUserId, type: NotificationTypeEnum.CollaboratorInvite, urlPath },
      });

    const waitForInviteNotification = async (toUserId: string, urlPath: string) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const notification = await prisma.notification.findFirst({
          where: { toUserId, type: NotificationTypeEnum.CollaboratorInvite, urlPath },
        });
        if (notification) {
          return notification;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    };

    const waitForListenerSettle = () => new Promise((resolve) => setTimeout(resolve, 500));

    it('notifies an existing user invited to a space by email', async () => {
      const invitee = await createInvitee('invite-notify-space@example.com');

      await awaitWithCollaboratorCreate(() =>
        emailSpaceInvitation({
          spaceId: notifySpaceId,
          emailSpaceInvitationRo: { role: Role.Editor, emails: [invitee.email] },
        })
      );

      const notification = await waitForInviteNotification(
        invitee.userId,
        `/space/${notifySpaceId}`
      );
      expect(notification).toBeTruthy();
      expect(notification?.fromUserId).toEqual(globalThis.testConfig.userId);
      expect(notification?.isRead).toEqual(false);
      expect(JSON.parse(notification!.messageI18n as string)).toEqual({
        i18nKey: 'email.templates.notify.collaboratorInvite.space',
        context: { fromUserName: inviterName, resourceName: spaceName },
      });

      const inviterNotifications = await findInviteNotifications(
        globalThis.testConfig.userId,
        `/space/${notifySpaceId}`
      );
      expect(inviterNotifications).toHaveLength(0);
    });

    it('notifies an existing user invited to a base by email', async () => {
      const invitee = await createInvitee('invite-notify-base@example.com');

      await awaitWithCollaboratorCreate(() =>
        emailBaseInvitation({
          baseId: notifyBaseId,
          emailBaseInvitationRo: { role: Role.Editor, emails: [invitee.email] },
        })
      );

      const notification = await waitForInviteNotification(invitee.userId, `/base/${notifyBaseId}`);
      expect(notification).toBeTruthy();
      expect(JSON.parse(notification!.messageI18n as string)).toEqual({
        i18nKey: 'email.templates.notify.collaboratorInvite.base',
        context: { fromUserName: inviterName, resourceName: baseName },
      });
    });

    it('notifies a user added directly as a space collaborator', async () => {
      const invitee = await createInvitee('invite-notify-add-space@example.com');

      await awaitWithCollaboratorCreate(() =>
        addSpaceCollaborator(notifySpaceId, {
          collaborators: [{ principalId: invitee.userId, principalType: PrincipalType.User }],
          role: Role.Editor,
        })
      );

      const notification = await waitForInviteNotification(
        invitee.userId,
        `/space/${notifySpaceId}`
      );
      expect(notification).toBeTruthy();
    });

    it('notifies a user added directly as a base collaborator', async () => {
      const invitee = await createInvitee('invite-notify-add-base@example.com');

      await awaitWithCollaboratorCreate(() =>
        addBaseCollaborator(notifyBaseId, {
          collaborators: [{ principalId: invitee.userId, principalType: PrincipalType.User }],
          role: Role.Editor,
        })
      );

      const notification = await waitForInviteNotification(invitee.userId, `/base/${notifyBaseId}`);
      expect(notification).toBeTruthy();
    });

    it('does not notify anyone when a batch invitation rolls back mid-way', async () => {
      const member = await createInvitee('invite-notify-batch-member@example.com');
      const bystander = await createInvitee('invite-notify-batch-bystander@example.com');

      await awaitWithCollaboratorCreate(() =>
        emailSpaceInvitation({
          spaceId: notifySpaceId,
          emailSpaceInvitationRo: { role: Role.Editor, emails: [member.email] },
        })
      );
      expect(
        await waitForInviteNotification(member.userId, `/space/${notifySpaceId}`)
      ).toBeTruthy();

      // member is already a collaborator, so the batch fails and rolls back
      await expect(
        emailSpaceInvitation({
          spaceId: notifySpaceId,
          emailSpaceInvitationRo: { role: Role.Editor, emails: [member.email, bystander.email] },
        })
      ).rejects.toThrow();
      await waitForListenerSettle();

      expect(
        await findInviteNotifications(bystander.userId, `/space/${notifySpaceId}`)
      ).toHaveLength(0);
      expect(await findInviteNotifications(member.userId, `/space/${notifySpaceId}`)).toHaveLength(
        1
      );
    });

    it('notifies a user account created by the email invitation itself', async () => {
      const email = 'invite-notify-new-user@example.com';
      await prisma.user.deleteMany({ where: { email } });

      await awaitWithCollaboratorCreate(() =>
        emailSpaceInvitation({
          spaceId: notifySpaceId,
          emailSpaceInvitationRo: { role: Role.Editor, emails: [email] },
        })
      );
      await waitForListenerSettle();

      // the notification sits unread until the account's first login — the only
      // in-app trace of the invite when the user signs up without the email link
      const newUser = await prisma.user.findFirstOrThrow({ where: { email } });
      inviteeIds.push(newUser.id);
      expect(await findInviteNotifications(newUser.id)).toHaveLength(1);
    });

    it('does not notify a user who joins through an invitation link', async () => {
      const invitee = await createInvitee('invite-notify-link@example.com');

      const invitationLinkRes = await apiCreateSpaceInvitationLink({
        spaceId: notifySpaceId,
        createSpaceInvitationLinkRo: { role: Role.Editor },
      });
      const { invitationId, invitationCode } =
        invitationLinkRes.data as CreateSpaceInvitationLinkVo;

      await awaitWithCollaboratorCreate(() =>
        invitee.request.post(ACCEPT_INVITATION_LINK, { invitationId, invitationCode })
      );
      await waitForListenerSettle();

      expect(await findInviteNotifications(invitee.userId)).toHaveLength(0);
    });

    it('does not notify the owner when creating a space', async () => {
      const spaceRes = await awaitWithCollaboratorCreate(() =>
        apiCreateSpace({ name: 'invite notify self space' })
      );
      await waitForListenerSettle();

      const ownerNotifications = await prisma.notification.findMany({
        where: {
          toUserId: globalThis.testConfig.userId,
          type: NotificationTypeEnum.CollaboratorInvite,
          urlPath: `/space/${spaceRes.data.id}`,
        },
      });
      expect(ownerNotifications).toHaveLength(0);

      await apiDeleteSpace(spaceRes.data.id);
    });
  });
});
