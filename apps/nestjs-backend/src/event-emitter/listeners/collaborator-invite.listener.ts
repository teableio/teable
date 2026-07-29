import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationSeverityEnum, NotificationTypeEnum } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CollaboratorType, MailTransporterType, MailType, PrincipalType } from '@teable/openapi';
import { MailSenderService } from '../../features/mail-sender/mail-sender.service';
import { NotificationService } from '../../features/notification/notification.service';
import { generateInvitationCode } from '../../utils/code-generate';
import { CollaboratorInvitedEvent, Events } from '../events';

@Injectable()
export class CollaboratorInviteListener {
  private readonly logger = new Logger(CollaboratorInviteListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailSenderService: MailSenderService
  ) {}

  @OnEvent(Events.COLLABORATOR_INVITED, { async: true })
  async listener(event: CollaboratorInvitedEvent): Promise<void> {
    try {
      await this.handleInvited(event);
    } catch (error) {
      this.logger.error(
        `Failed to handle collaborator invited event: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  }

  private async handleInvited(event: CollaboratorInvitedEvent): Promise<void> {
    const { resourceId, resourceType, invitees, createdBy } = event;
    if (!invitees.length) {
      return;
    }

    const fromUser = await this.prismaService.user.findUnique({
      where: { id: createdBy },
      select: { name: true, email: true },
    });
    if (!fromUser) {
      return;
    }

    const isSpace = resourceType === CollaboratorType.Space;
    const resource = isSpace
      ? await this.prismaService.space.findUnique({
          where: { id: resourceId, deletedTime: null },
          select: { name: true },
        })
      : await this.prismaService.base.findUnique({
          where: { id: resourceId, deletedTime: null },
          select: { name: true },
        });
    if (!resource) {
      return;
    }

    // Settled, not sequential: a failing notification must not swallow the mail leg.
    const [notified, mailed] = await Promise.allSettled([
      this.notifyInvitees(event, fromUser.name, resource.name),
      this.sendInviteEmails(event, fromUser, resource.name),
    ]);
    this.logRejection('notify invitees', notified);
    this.logRejection('send invite emails', mailed);
  }

  private logRejection(leg: string, result: PromiseSettledResult<void>): void {
    if (result.status === 'rejected') {
      const error = result.reason as Error;
      this.logger.error(`Failed to ${leg}: ${error?.message}`, error?.stack);
    }
  }

  private async notifyInvitees(
    event: CollaboratorInvitedEvent,
    fromUserName: string,
    resourceName: string
  ): Promise<void> {
    const { resourceId, resourceType, invitees, createdBy } = event;
    // Accounts pre-created by the invitation itself are notified too: the
    // notification sits unread until their first login, which is the only
    // in-app trace of the invite when they sign up without the email link.
    const toUserIds = invitees
      .filter((c) => c.principalType === PrincipalType.User && c.principalId !== createdBy)
      .map((c) => c.principalId);
    if (!toUserIds.length) {
      return;
    }

    const isSpace = resourceType === CollaboratorType.Space;
    await this.notificationService.sendCommonNotify(
      {
        path: isSpace ? `/space/${resourceId}` : `/base/${resourceId}`,
        fromUserId: createdBy,
        toUserId: toUserIds,
        message: {
          i18nKey: isSpace
            ? 'common.email.templates.notify.collaboratorInvite.space'
            : 'common.email.templates.notify.collaboratorInvite.base',
          context: {
            fromUserName,
            resourceName,
          },
        },
        severity: NotificationSeverityEnum.Info,
      },
      NotificationTypeEnum.CollaboratorInvite
    );
  }

  private async sendInviteEmails(
    event: CollaboratorInvitedEvent,
    fromUser: { name: string; email: string },
    resourceName: string
  ): Promise<void> {
    const { resourceId, resourceType, invitees, skipSendMail } = event;
    if (skipSendMail) {
      return;
    }

    for (const invitee of invitees) {
      if (!invitee.invitationId || !invitee.email) {
        continue;
      }
      try {
        const invitationCode = generateInvitationCode(invitee.invitationId);
        const inviteEmailOptions = await this.mailSenderService.inviteEmailOptions({
          name: fromUser.name,
          email: fromUser.email,
          resourceName,
          resourceType,
          inviteUrl: this.mailSenderService.generateInviteUrl(invitee.invitationId, invitationCode),
        });
        this.mailSenderService.sendMail(
          {
            to: invitee.email,
            ...inviteEmailOptions,
          },
          {
            type: MailType.Invite,
            transporterName: MailTransporterType.Notify,
          }
        );
        // one line per recipient — SigNoz alerts count these to detect
        // mass-invitation abuse and group by `inviterId` to feed the
        // suspicious-account pipeline, so field keys are a downstream contract
        this.logger.log({
          event: 'invitation.email.sent',
          inviterId: event.createdBy,
          inviterEmail: fromUser.email,
          inviteeEmail: invitee.email,
          resourceType,
          resourceId,
          msg: 'invitation email sent',
        });
      } catch (error) {
        this.logger.error(
          `Failed to send invitation email: invitationId=${invitee.invitationId} inviteeEmail=${invitee.email} ${(error as Error).message}`,
          (error as Error).stack
        );
      }
    }
  }
}
