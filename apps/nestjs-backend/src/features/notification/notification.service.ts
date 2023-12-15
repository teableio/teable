import { Injectable, Logger } from '@nestjs/common';
import type { ISendMailOptions } from '@nestjs-modules/mailer';
import type { INotificationBuffer } from '@teable-group/core';
import {
  generateNotificationId,
  getUserNotificationChannel,
  NotificationStatesEnum,
  NotificationTypeEnum,
  notificationUrlSchema,
  userIconSchema,
} from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { PrismaService } from '@teable-group/db-main-prisma';
import type {
  IGetNotifyListQuery,
  INotificationUnreadCountVo,
  INotificationVo,
  IUpdateNotifyStatusRo,
} from '@teable-group/openapi';
import { ShareDbService } from '../../share-db/share-db.service';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { UserService } from '../user/user.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly mailSenderService: MailSenderService,
    private readonly userService: UserService
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
    const toUser = await this.userService.getUserById(toUserId);

    if (!toUser) {
      return;
    }

    const notifyId = generateNotificationId();
    const emailOptions = this.mailSenderService.collaboratorCellTagEmailOptions({
      toUserName: toUser.name,
      refRecord,
    });

    const userIcon = userIconSchema.parse({
      userId: toUser.id,
      userName: toUser.name,
      userAvatarUrl: toUser.avatar,
    });

    const urlMeta = notificationUrlSchema.parse({
      baseId: refRecord.baseId,
      tableId: refRecord.tableId,
      ...(refRecord.recordIds.length === 1 ? { recordId: refRecord.recordIds[0] } : {}),
    });

    const data: Prisma.NotificationCreateInput = {
      id: notifyId,
      fromUser: fromUserId,
      toUser: toUserId,
      type:
        refRecord.recordIds.length > 1
          ? NotificationTypeEnum.CollaboratorMultiRowTag
          : NotificationTypeEnum.CollaboratorCellTag,
      message: emailOptions.notifyMessage,
      iconMeta: JSON.stringify(userIcon),
      urlMeta: JSON.stringify(urlMeta),
      createdBy: fromUserId,
    };
    const notifyData = await this.createNotify(data);

    const socketNotification = {
      notification: {
        id: notifyData.id,
        message: notifyData.message,
        notifyIcon: JSON.parse(data.iconMeta),
        notifyType: notifyData.type as NotificationTypeEnum,
        url:
          emailOptions.context.viewRecordUrlPrefix + `${urlMeta.recordId ? urlMeta.recordId : ''}`,
        isRead: false,
        createdTime: notifyData.createdTime.toISOString(),
      },
      unreadCount: (await this.unreadCount(toUser.id)).unreadCount,
    };

    this.sendNotifyBySocket(toUser.id, socketNotification);

    if (toUser.notifyMeta && toUser.notifyMeta.email) {
      // this.sendNotifyByMail(toUser.email, emailOptions);
    }
  }

  async getNotifyList(userId: string, query: IGetNotifyListQuery): Promise<INotificationVo> {
    const { notifyStates, cursor } = query;
    const limit = 5;

    const data = await this.prismaService.txClient().notification.findMany({
      where: {
        toUser: userId,
        isRead: notifyStates === NotificationStatesEnum.Read,
      },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        createdTime: 'desc',
      },
    });

    const notifications = data.map((v) => {
      const notifyIcon = JSON.parse(v.iconMeta);
      return {
        id: v.id,
        notifyIcon: notifyIcon,
        notifyType: v.type as NotificationTypeEnum,
        url: v.urlMeta,
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

  async unreadCount(userId: string): Promise<INotificationUnreadCountVo> {
    const unreadCount = await this.prismaService.txClient().notification.count({
      where: {
        toUser: userId,
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

    await this.prismaService.txClient().notification.updateMany({
      where: {
        id: notificationId,
        toUser: userId,
      },
      data: {
        isRead: isRead,
      },
    });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.prismaService.txClient().notification.updateMany({
      where: {
        toUser: userId,
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
