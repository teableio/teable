import { Injectable, Logger } from '@nestjs/common';
import type { INotificationBuffer, INotificationUrl } from '@teable/core';
import {
  generateNotificationId,
  getUserNotificationChannel,
  NotificationStatesEnum,
  NotificationTypeEnum,
  notificationUrlSchema,
  userIconSchema,
  SYSTEM_USER_ID,
  assertNever,
} from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import {
  MailTransporterType,
  MailType,
  type IGetNotifyListQuery,
  type INotificationUnreadCountVo,
  type INotificationVo,
  type IUpdateNotifyStatusRo,
} from '@teable/openapi';
import { keyBy } from 'lodash';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { ShareDbService } from '../../share-db/share-db.service';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { UserService } from '../user/user.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly mailTypeMap: Record<NotificationTypeEnum, MailType> = {
    [NotificationTypeEnum.System]: MailType.System,
    [NotificationTypeEnum.CollaboratorCellTag]: MailType.CollaboratorCellTag,
    [NotificationTypeEnum.CollaboratorMultiRowTag]: MailType.CollaboratorMultiRowTag,
    [NotificationTypeEnum.Comment]: MailType.Common,
    [NotificationTypeEnum.ExportBase]: MailType.ExportBase,
  };
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
    const emailOptions = await this.mailSenderService.collaboratorCellTagEmailOptions({
      notifyId,
      fromUserName: fromUser.name,
      refRecord,
    });

    const userIcon = userIconSchema.parse({
      userId: fromUser.id,
      userName: fromUser.name,
      userAvatarUrl: fromUser?.avatar && getPublicFullStorageUrl(fromUser.avatar),
    });

    const urlMeta = notificationUrlSchema.parse({
      baseId: refRecord.baseId,
      tableId: refRecord.tableId,
      ...(refRecord.recordIds.length === 1 ? { recordId: refRecord.recordIds[0] } : {}),
    });
    const type =
      refRecord.recordIds.length > 1
        ? NotificationTypeEnum.CollaboratorMultiRowTag
        : NotificationTypeEnum.CollaboratorCellTag;

    const notifyPath = this.generateNotifyPath(type as NotificationTypeEnum, urlMeta);

    const data: Prisma.NotificationCreateInput = {
      id: notifyId,
      fromUserId,
      toUserId,
      type,
      message: emailOptions.notifyMessage,
      urlPath: notifyPath,
      createdBy: fromUserId,
    };
    const notifyData = await this.createNotify(data);

    const unreadCount = (await this.unreadCount(toUser.id)).unreadCount;

    const socketNotification = {
      notification: {
        id: notifyData.id,
        message: notifyData.message,
        notifyIcon: userIcon,
        notifyType: notifyData.type as NotificationTypeEnum,
        url: this.mailConfig.origin + notifyPath,
        isRead: false,
        createdTime: notifyData.createdTime.toISOString(),
      },
      unreadCount: unreadCount,
    };

    this.sendNotifyBySocket(toUser.id, socketNotification);

    if (toUser.notifyMeta && toUser.notifyMeta.email) {
      this.mailSenderService.sendMail(
        {
          to: toUser.email,
          ...emailOptions,
        },
        {
          type: this.mailTypeMap[type],
          transporterName: MailTransporterType.Notify,
        }
      );
    }
  }

  async sendHtmlContentNotify(
    params: {
      path: string;
      fromUserId?: string;
      toUserId: string;
      message: string;
      emailConfig?: {
        title: string;
        message: string;
        buttonUrl?: string;
        buttonText?: string;
      };
    },
    type = NotificationTypeEnum.System
  ) {
    const { toUserId, emailConfig, message, path, fromUserId = SYSTEM_USER_ID } = params;
    const notifyId = generateNotificationId();
    const toUser = await this.userService.getUserById(toUserId);
    if (!toUser) {
      return;
    }

    const data: Prisma.NotificationCreateInput = {
      id: notifyId,
      fromUserId: fromUserId,
      toUserId,
      type,
      urlPath: path,
      createdBy: fromUserId,
      message,
    };
    const notifyData = await this.createNotify(data);

    const unreadCount = (await this.unreadCount(toUser.id)).unreadCount;

    const rawUsers = await this.prismaService.user.findMany({
      select: { id: true, name: true, avatar: true },
      where: { id: fromUserId },
    });
    const fromUserSets = keyBy(rawUsers, 'id');

    const systemNotifyIcon = this.generateNotifyIcon(
      notifyData.type as NotificationTypeEnum,
      fromUserId,
      fromUserSets
    );

    const socketNotification = {
      notification: {
        id: notifyData.id,
        message: notifyData.message,
        notifyType: type,
        url: path,
        notifyIcon: systemNotifyIcon,
        isRead: false,
        createdTime: notifyData.createdTime.toISOString(),
      },
      unreadCount: unreadCount,
    };

    this.sendNotifyBySocket(toUser.id, socketNotification);

    if (emailConfig && toUser.notifyMeta && toUser.notifyMeta.email) {
      const emailOptions = await this.mailSenderService.htmlEmailOptions({
        ...emailConfig,
        to: toUserId,
        buttonUrl: emailConfig.buttonUrl || this.mailConfig.origin + path,
        buttonText: emailConfig.buttonText || 'View',
      });
      this.mailSenderService.sendMail(
        {
          to: toUser.email,
          ...emailOptions,
        },
        {
          type: this.mailTypeMap[type],
          transporterName: MailTransporterType.Notify,
        }
      );
    }
  }

  async sendCommonNotify(
    params: {
      path: string;
      fromUserId?: string;
      toUserId: string;
      message: string;
      emailConfig?: {
        title: string;
        message: string;
        buttonUrl?: string; // use path as default
        buttonText?: string; // use 'View' as default
      };
    },
    type = NotificationTypeEnum.System
  ) {
    const { toUserId, emailConfig, message, path, fromUserId = SYSTEM_USER_ID } = params;
    const notifyId = generateNotificationId();
    const toUser = await this.userService.getUserById(toUserId);
    if (!toUser) {
      return;
    }

    const data: Prisma.NotificationCreateInput = {
      id: notifyId,
      fromUserId: fromUserId,
      toUserId,
      type,
      urlPath: path,
      createdBy: fromUserId,
      message,
    };
    const notifyData = await this.createNotify(data);

    const unreadCount = (await this.unreadCount(toUser.id)).unreadCount;

    const rawUsers = await this.prismaService.user.findMany({
      select: { id: true, name: true, avatar: true },
      where: { id: fromUserId },
    });
    const fromUserSets = keyBy(rawUsers, 'id');

    const systemNotifyIcon = this.generateNotifyIcon(
      notifyData.type as NotificationTypeEnum,
      fromUserId,
      fromUserSets
    );

    const socketNotification = {
      notification: {
        id: notifyData.id,
        message: notifyData.message,
        notifyType: type,
        url: path,
        notifyIcon: systemNotifyIcon,
        isRead: false,
        createdTime: notifyData.createdTime.toISOString(),
      },
      unreadCount: unreadCount,
    };

    this.sendNotifyBySocket(toUser.id, socketNotification);

    if (emailConfig && toUser.notifyMeta && toUser.notifyMeta.email) {
      const emailOptions = await this.mailSenderService.commonEmailOptions({
        ...emailConfig,
        to: toUserId,
        buttonUrl: emailConfig.buttonUrl || this.mailConfig.origin + path,
        buttonText: emailConfig.buttonText || 'View',
      });
      this.mailSenderService.sendMail(
        {
          to: toUser.email,
          ...emailOptions,
        },
        {
          type: this.mailTypeMap[type],
          transporterName: MailTransporterType.Notify,
        }
      );
    }
  }

  async sendImportResultNotify(params: {
    tableId: string;
    baseId: string;
    toUserId: string;
    message: string;
  }) {
    const { toUserId, tableId, message, baseId } = params;
    const toUser = await this.userService.getUserById(toUserId);
    if (!toUser) {
      return;
    }
    const type = NotificationTypeEnum.System;
    const urlMeta = notificationUrlSchema.parse({
      baseId: baseId,
      tableId: tableId,
    });
    const notifyPath = this.generateNotifyPath(type, urlMeta);

    this.sendCommonNotify({
      path: notifyPath,
      toUserId,
      message,
      emailConfig: {
        title: 'Import result notification',
        message: message,
      },
    });
  }

  async sendExportBaseResultNotify(params: { baseId: string; toUserId: string; message: string }) {
    const { toUserId, message } = params;
    const toUser = await this.userService.getUserById(toUserId);
    if (!toUser) {
      return;
    }
    const type = NotificationTypeEnum.ExportBase;

    this.sendHtmlContentNotify(
      {
        path: '',
        toUserId,
        message,
        emailConfig: {
          title: 'Export base result notification',
          message: message,
        },
      },
      type
    );
  }

  async sendCommentNotify(params: {
    baseId: string;
    tableId: string;
    recordId: string;
    commentId: string;
    toUserId: string;
    message: string;
    fromUserId: string;
  }) {
    const { toUserId, tableId, message, baseId, commentId, recordId, fromUserId } = params;
    const toUser = await this.userService.getUserById(toUserId);
    if (!toUser) {
      return;
    }
    const type = NotificationTypeEnum.Comment;
    const urlMeta = notificationUrlSchema.parse({
      baseId: baseId,
      tableId: tableId,
      recordId: recordId,
      commentId: commentId,
    });
    const notifyPath = this.generateNotifyPath(type, urlMeta);

    this.sendCommonNotify(
      {
        path: notifyPath,
        fromUserId,
        toUserId,
        message,
        emailConfig: {
          title: 'Record comment notification',
          message: message,
        },
      },
      type
    );
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
      const notifyIcon = this.generateNotifyIcon(
        v.type as NotificationTypeEnum,
        v.fromUserId,
        fromUserSets
      );
      return {
        id: v.id,
        notifyIcon: notifyIcon,
        notifyType: v.type as NotificationTypeEnum,
        url: this.mailConfig.origin + v.urlPath,
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
      case NotificationTypeEnum.ExportBase:
        return { iconUrl: `${origin}/images/favicon/favicon.svg` };
      case NotificationTypeEnum.Comment:
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag: {
        const { id, name, avatar } = fromUserSets[fromUserId];

        return {
          userId: id,
          userName: name,
          userAvatarUrl: avatar && getPublicFullStorageUrl(avatar),
        };
      }
      default:
        throw assertNever(notifyType);
    }
  }

  private generateNotifyPath(notifyType: NotificationTypeEnum, urlMeta: INotificationUrl) {
    switch (notifyType) {
      case NotificationTypeEnum.System: {
        const { baseId, tableId } = urlMeta || {};
        return `/base/${baseId}/${tableId}`;
      }
      case NotificationTypeEnum.Comment: {
        const { baseId, tableId, recordId, commentId } = urlMeta || {};

        return `/base/${baseId}/${tableId}${`?recordId=${recordId}&commentId=${commentId}`}`;
      }
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag: {
        const { baseId, tableId, recordId } = urlMeta || {};

        return `/base/${baseId}/${tableId}${recordId ? `?recordId=${recordId}` : ''}`;
      }
      case NotificationTypeEnum.ExportBase: {
        const { downloadUrl } = urlMeta || {};
        return downloadUrl as string;
      }
      default:
        throw assertNever(notifyType);
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

  private async sendNotifyBySocket(toUserId: string, data: INotificationBuffer) {
    const channel = getUserNotificationChannel(toUserId);

    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(data.notification.id);

    return new Promise((resolve) => {
      localPresence.submit(data, (error) => {
        error && this.logger.error(error);
        resolve(data);
      });
    });
  }
}
