import { Injectable, Logger } from '@nestjs/common';
import type { ISendMailOptions } from '@nestjs-modules/mailer';
import type { INotificationBuffer, INotificationUrl } from '@teable/core';
import {
  generateNotificationId,
  getUserNotificationChannel,
  NotificationStatesEnum,
  NotificationTypeEnum,
  notificationUrlSchema,
  userIconSchema,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IGetNotifyListQuery,
  INotificationUnreadCountVo,
  INotificationVo,
  IUpdateNotifyStatusRo,
} from '@teable/openapi';
import { keyBy } from 'lodash';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { ShareDbService } from '../../share-db/share-db.service';
import { getFullStorageUrl } from '../../utils/full-storage-url';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { UserService } from '../user/user.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly mailSenderService: MailSenderService,
    private readonly userService: UserService,
    @MailConfig() private readonly mailConfig: IMailConfig
  ) {}

  async sendCollaboratorNotify(params: {
    fromUserId: string;
    toUserId: string;
    refRecord: {
      baseId: string;
      tableId: string;
      tableName: string;
      fieldName: string;
      recordIds: string[];
    };
  }): Promise<void> {
    const { fromUserId, toUserId, refRecord } = params;
    const [fromUser, toUser] = await Promise.all([
      this.userService.getUserById(fromUserId),
      this.userService.getUserById(toUserId),
    ]);

    if (!fromUser || !toUser || fromUserId === toUserId) {
      return;
    }

    const notifyId = generateNotificationId();
    const emailOptions = this.mailSenderService.collaboratorCellTagEmailOptions({
      notifyId,
      fromUserName: fromUser.name,
      refRecord,
    });

    const userIcon = userIconSchema.parse({
      userId: fromUser.id,
      userName: fromUser.name,
      userAvatarUrl: fromUser?.avatar && getFullStorageUrl(fromUser.avatar),
    });

    const urlMeta = notificationUrlSchema.parse({
      baseId: refRecord.baseId,
      tableId: refRecord.tableId,
      ...(refRecord.recordIds.length === 1 ? { recordId: refRecord.recordIds[0] } : {}),
    });

    const data: Prisma.NotificationCreateInput = {
      id: notifyId,
      fromUserId: fromUserId,
      toUserId: toUserId,
      type:
        refRecord.recordIds.length > 1
          ? NotificationTypeEnum.CollaboratorMultiRowTag
          : NotificationTypeEnum.CollaboratorCellTag,
      message: emailOptions.notifyMessage,
      urlMeta: JSON.stringify(urlMeta),
      createdBy: fromUserId,
    };
    const notifyData = await this.createNotify(data);

    const notifyUrl = this.generateNotifyUrl(notifyData.type as NotificationTypeEnum, urlMeta);
    const unreadCount = (await this.unreadCount(toUser.id)).unreadCount;

    const socketNotification = {
      notification: {
        id: notifyData.id,
        message: notifyData.message,
        notifyIcon: userIcon,
        notifyType: notifyData.type as NotificationTypeEnum,
        url: notifyUrl,
        isRead: false,
        createdTime: notifyData.createdTime.toISOString(),
      },
      unreadCount: unreadCount,
    };

    this.sendNotifyBySocket(toUser.id, socketNotification);

    if (toUser.notifyMeta && toUser.notifyMeta.email) {
      this.sendNotifyByMail(toUser.email, emailOptions);
    }
  }

  async getNotifyList(userId: string, query: IGetNotifyListQuery): Promise<INotificationVo> {
    const { notifyStates, cursor } = query;
    const limit = 10;

    const data = await this.prismaService.notification.findMany({
      where: {
        toUserId: userId,
        isRead: notifyStates === NotificationStatesEnum.Read,
      },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        createdTime: 'desc',
      },
    });

    // Doesn't seem like a good way
    const fromUserIds = data.map((v) => v.fromUserId);
    const rawUsers = await this.prismaService.user.findMany({
      select: { id: true, name: true, avatar: true },
      where: { id: { in: fromUserIds } },
    });
    const fromUserSets = keyBy(rawUsers, 'id');

    const notifications = data.map((v) => {
      const urlMeta = v.urlMeta && JSON.parse(v.urlMeta);

      const notifyIcon = this.generateNotifyIcon(
        v.type as NotificationTypeEnum,
        v.fromUserId,
        fromUserSets
      );
      const notifyUrl = this.generateNotifyUrl(v.type as NotificationTypeEnum, urlMeta);
      return {
        id: v.id,
        notifyIcon: notifyIcon,
        notifyType: v.type as NotificationTypeEnum,
        url: notifyUrl,
        message: v.message,
        isRead: v.isRead,
        createdTime: v.createdTime.toISOString(),
      };
    });

    let nextCursor: typeof cursor | undefined = undefined;
    if (notifications.length > limit) {
      const nextItem = notifications.pop();
      nextCursor = nextItem!.id;
    }
    return {
      notifications,
      nextCursor,
    };
  }

  private generateNotifyIcon(
    notifyType: NotificationTypeEnum,
    fromUserId: string,
    fromUserSets: Record<string, { id: string; name: string; avatar: string | null }>
  ) {
    const origin = this.mailConfig.origin;

    switch (notifyType) {
      case NotificationTypeEnum.System:
        return { iconUrl: origin };
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag: {
        const { id, name, avatar } = fromUserSets[fromUserId];

        return {
          userId: id,
          userName: name,
          userAvatarUrl: avatar && getFullStorageUrl(avatar),
        };
      }
    }
  }

  private generateNotifyUrl(notifyType: NotificationTypeEnum, urlMeta: INotificationUrl) {
    const origin = this.mailConfig.origin;

    switch (notifyType) {
      case NotificationTypeEnum.System:
        return origin;
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag: {
        const { baseId, tableId, recordId } = urlMeta || {};

        return `${origin}/base/${baseId}/${tableId}?recordId=${recordId}`;
      }
    }
  }

  async unreadCount(userId: string): Promise<INotificationUnreadCountVo> {
    const unreadCount = await this.prismaService.notification.count({
      where: {
        toUserId: userId,
        isRead: false,
      },
    });
    return { unreadCount };
  }

  async updateNotifyStatus(
    userId: string,
    notificationId: string,
    updateNotifyStatusRo: IUpdateNotifyStatusRo
  ): Promise<void> {
    const { isRead } = updateNotifyStatusRo;

    await this.prismaService.notification.updateMany({
      where: {
        id: notificationId,
        toUserId: userId,
      },
      data: {
        isRead: isRead,
      },
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.prismaService.notification.updateMany({
      where: {
        toUserId: userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });
  }

  private async createNotify(data: Prisma.NotificationCreateInput) {
    return this.prismaService.notification.create({ data });
  }

  private sendNotifyBySocket(toUserId: string, data: INotificationBuffer) {
    const channel = getUserNotificationChannel(toUserId);

    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(data.notification.id);

    localPresence.submit(data, (error) => {
      error && this.logger.error(error);
    });
  }

  private async sendNotifyByMail(to: string, emailOptions: ISendMailOptions) {
    await this.mailSenderService.sendMail({
      to,
      ...emailOptions,
    });
  }
}
