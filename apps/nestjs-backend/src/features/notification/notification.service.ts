import { Injectable, Logger } from '@nestjs/common';
import type { ILocalization, INotificationBuffer, INotificationUrl } from '@teable/core';
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
import { MailTransporterType, MailType } from '@teable/openapi';
import {
  type IGetNotifyListQuery,
  type INotificationUnreadCountVo,
  type INotificationVo,
  type IUpdateNotifyStatusRo,
} from '@teable/openapi';
import { keyBy } from 'lodash';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { ShareDbService } from '../../share-db/share-db.service';
import type { I18nPath, I18nTranslations } from '../../types/i18n.generated';
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
    @MailConfig() private readonly mailConfig: IMailConfig,
    private readonly i18n: I18nService<I18nTranslations>
  ) {}

  getUserLang(lang?: string | null) {
    return lang ?? I18nContext.current()?.lang;
  }

  getMessage(text: string | ILocalization<I18nPath>, lang?: string) {
    return typeof text === 'string'
      ? text
      : (this.i18n.t(text.i18nKey, {
          args: text.context,
          lang: lang ?? I18nContext.current()?.lang,
        }) as string);
  }

  /**
   * notification message i18n use common prefix, so we need to remove it to save db
   */
  getMessageI18n(localization: string | ILocalization<I18nPath>) {
    return typeof localization === 'string'
      ? undefined
      : JSON.stringify({
          // remove common prefix
          // eg: common.email.templates -> email.templates
          i18nKey: localization.i18nKey.replace(/^common\./, ''),
          context: localization.context,
        });
  }

  async sendCollaboratorNotify(params: {
    fromUserId: string;
    toUserId: string;
    refRecord: {
      baseId: string;
      tableId: string;
      tableName: string;
      fieldName: string;
      recordIds: string[];
      recordTitles: { id: string; title: string }[];
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

    let message: string | ILocalization<I18nPath> = '';
    if (refRecord.recordIds.length <= 1) {
      message = {
        i18nKey: 'common.email.templates.collaboratorCellTag.subject',
        context: {
          fromUserName: fromUser.name,
          fieldName: refRecord.fieldName,
          tableName: refRecord.tableName,
        },
      };
    } else {
      message = {
        i18nKey: 'common.email.templates.collaboratorMultiRowTag.subject',
        context: {
          fromUserName: fromUser.name,
          refLength: refRecord.recordIds.length.toString(),
          tableName: refRecord.tableName,
        },
      };
    }
    const data: Prisma.NotificationCreateInput = {
      id: notifyId,
      fromUserId,
      toUserId,
      type,
      message: this.getMessage(message, 'en'),
      messageI18n: this.getMessageI18n(message),
      urlPath: notifyPath,
      createdBy: fromUserId,
    };
    const notifyData = await this.createNotify(data);

    const unreadCount = (await this.unreadCount(toUser.id)).unreadCount;

    const socketNotification = {
      notification: {
        id: notifyData.id,
        message: notifyData.message,
        messageI18n: notifyData.messageI18n,
        notifyIcon: userIcon,
        notifyType: notifyData.type as NotificationTypeEnum,
        url: this.mailConfig.origin + notifyPath,
        isRead: false,
        createdTime: notifyData.createdTime.toISOString(),
      },
      unreadCount: unreadCount,
    };

    this.sendNotifyBySocket(toUser.id, socketNotification);

    const emailOptions = await this.mailSenderService.collaboratorCellTagEmailOptions({
      notifyId,
      fromUserName: fromUser.name,
      refRecord,
    });
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
      message: string | ILocalization<I18nPath>;
      emailConfig?: {
        title: string | ILocalization<I18nPath>;
        message: string | ILocalization<I18nPath>;
        buttonUrl?: string;
        buttonText?: string | ILocalization<I18nPath>;
      };
    },
    type = NotificationTypeEnum.System
  ) {
    const { toUserId, emailConfig, path, fromUserId = SYSTEM_USER_ID } = params;
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
      message: this.getMessage(params.message, 'en'),
      messageI18n: this.getMessageI18n(params.message),
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
        messageI18n: notifyData.messageI18n,
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
      const lang = this.getUserLang(toUser.lang);
      const emailOptions = await this.mailSenderService.htmlEmailOptions({
        ...emailConfig,
        title: this.getMessage(emailConfig.title, lang),
        message: this.getMessage(emailConfig.message, lang),
        to: toUserId,
        buttonUrl: emailConfig.buttonUrl || this.mailConfig.origin + path,
        buttonText: emailConfig.buttonText
          ? this.getMessage(emailConfig.buttonText, lang)
          : this.i18n.t('common.email.templates.notify.buttonText'),
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
      message: string | ILocalization<I18nPath>;
      emailConfig?: {
        title: string | ILocalization<I18nPath>;
        message: string | ILocalization<I18nPath>;
        buttonUrl?: string; // use path as default
        buttonText?: string | ILocalization<I18nPath>; // use 'View' as default
      };
    },
    type = NotificationTypeEnum.System
  ) {
    const { toUserId, emailConfig, path, fromUserId = SYSTEM_USER_ID } = params;
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
      message: this.getMessage(params.message, 'en'),
      messageI18n: this.getMessageI18n(params.message),
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
        messageI18n: notifyData.messageI18n,
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
      const lang = this.getUserLang(toUser.lang);
      const emailOptions = await this.mailSenderService.commonEmailOptions({
        ...emailConfig,
        title: this.getMessage(emailConfig.title, lang),
        message: this.getMessage(emailConfig.message, lang),
        to: toUserId,
        buttonUrl: emailConfig.buttonUrl || this.mailConfig.origin + path,
        buttonText: emailConfig.buttonText
          ? this.getMessage(emailConfig.buttonText, lang)
          : this.i18n.t('common.email.templates.notify.buttonText'),
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
    message: string | ILocalization<I18nPath>;
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
        title: { i18nKey: 'common.email.templates.notify.import.title' },
        message,
      },
    });
  }

  async sendExportBaseResultNotify(params: {
    baseId: string;
    toUserId: string;
    message: string | ILocalization<I18nPath>;
  }) {
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
          title: { i18nKey: 'common.email.templates.notify.exportBase.title' },
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
    message: string | ILocalization<I18nPath>;
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
          title: { i18nKey: 'common.email.templates.notify.recordComment.title' },
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
        messageI18n: v.messageI18n,
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
        return `/base/${baseId}/table/${tableId}`;
      }
      case NotificationTypeEnum.Comment: {
        const { baseId, tableId, recordId, commentId } = urlMeta || {};

        return `/base/${baseId}/table/${tableId}${`?recordId=${recordId}&commentId=${commentId}`}`;
      }
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag: {
        const { baseId, tableId, recordId } = urlMeta || {};

        return `/base/${baseId}/table/${tableId}${recordId ? `?recordId=${recordId}` : ''}`;
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
