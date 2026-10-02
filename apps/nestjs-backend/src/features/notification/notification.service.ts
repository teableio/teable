import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ILocalization, INotificationBuffer, INotificationUrl } from '@teable/core';
import {
  assertNever,
  generateNotificationId,
  getUserNotificationChannel,
  IdPrefix,
  NotificationStatesEnum,
  NotificationSeverityEnum,
  NotificationTypeEnum,
  notificationUrlSchema,
  SYSTEM_USER_ID,
  userIconSchema,
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
import { escape, keyBy, uniq } from 'lodash';
import ms from 'ms';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { CacheService } from '../../cache/cache.service';
import type { ICacheStore } from '../../cache/types';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { DistributedLockService } from '../../distributed-lock';
import { ShareDbService } from '../../share-db/share-db.service';
import type { I18nPath, I18nTranslations } from '../../types/i18n.generated';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { UserService } from '../user/user.service';

type INotifyEmailConfig = {
  title: string | ILocalization<I18nPath>;
  message: string | ILocalization<I18nPath>;
  buttonUrl?: string;
  buttonText?: string | ILocalization<I18nPath>;
};

function toArray<T>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const notificationListLimit = 10;

// Collaborator notifies from one actor to one user in one table coalesce: a notify with
// no open window is sent at once and opens one, later ones buffer in the shared cache and
// go out as one notification once writes stay quiet. Every pod that touched a window runs
// its own flush timer, so a buffer outlives the pod that filled it.
const defaultCollaboratorNotifyQuietMs = ms('10s');
export const maxCollaboratorNotifyRecordTitles = 10;

const resolveCollaboratorNotifyQuietMs = (): number => {
  const raw = process.env.USER_FIELD_NOTIFY_BATCH_WINDOW_MS;
  // Number('') is 0, so only an explicit 0 disables coalescing.
  if (!raw?.trim()) {
    return defaultCollaboratorNotifyQuietMs;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultCollaboratorNotifyQuietMs;
};

type ICollaboratorNotifyParams = {
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
};

const notificationListSelect = {
  id: true,
  fromUserId: true,
  type: true,
  urlPath: true,
  message: true,
  messageI18n: true,
  severity: true,
  isRead: true,
  createdTime: true,
} satisfies Prisma.NotificationSelect;

const systemIconUrl = '/images/favicon/favicon.svg';

// The alphabet generated ids are drawn from (nanoid's, in @teable/core's id generator).
const idAlphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The id of the notification an app sends a user under its own `externalId`: the same three
 * give the same id, in the shape of a generated one ('not' + 16 of nanoid's alphabet).
 */
const appNotificationId = (clientId: string, toUserId: string, externalId: string) => {
  const digest = createHash('sha256').update(`${clientId}\n${toUserId}\n${externalId}`).digest();
  const chars = Array.from(digest.subarray(0, 16), (byte) => idAlphabet[byte % idAlphabet.length]);
  return IdPrefix.Notification + chars.join('');
};

type INotificationListRecord = Prisma.NotificationGetPayload<{
  select: typeof notificationListSelect;
}>;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly collaboratorNotifyTimers = new Set<string>();
  private readonly mailTypeMap: Record<NotificationTypeEnum, MailType> = {
    [NotificationTypeEnum.System]: MailType.System,
    [NotificationTypeEnum.CollaboratorCellTag]: MailType.CollaboratorCellTag,
    [NotificationTypeEnum.CollaboratorMultiRowTag]: MailType.CollaboratorMultiRowTag,
    [NotificationTypeEnum.Comment]: MailType.Common,
    [NotificationTypeEnum.ExportBase]: MailType.ExportBase,
    [NotificationTypeEnum.AdminNotice]: MailType.System,
    [NotificationTypeEnum.CollaboratorInvite]: MailType.Common,
    // never mailed: the app reaches its users on its own
    [NotificationTypeEnum.OAuthApp]: MailType.Common,
  };
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly mailSenderService: MailSenderService,
    private readonly userService: UserService,
    @MailConfig() private readonly mailConfig: IMailConfig,
    private readonly i18n: I18nService<I18nTranslations>,
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly distributedLockService: DistributedLockService
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

  async sendCollaboratorNotify(params: ICollaboratorNotifyParams): Promise<void> {
    const { fromUserId, toUserId, refRecord } = params;
    if (fromUserId === toUserId) {
      return;
    }
    const quietMs = resolveCollaboratorNotifyQuietMs();
    if (quietMs <= 0) {
      await this.createCollaboratorNotify(params);
      return;
    }

    // The window lapses on its own once writes stay quiet.
    const windowTtlSeconds = Math.ceil(quietMs / 1000);
    const key = `${fromUserId}:${toUserId}:${refRecord.tableId}`;
    const buffered = await this.withCollaboratorNotifyLock(key, async () => {
      // Records still waiting to go out, e.g. left by a dead pod, keep this notify buffered too.
      const current = await this.cacheService.get(`collaborator-notify:pending:${key}`);
      if (!current && !(await this.cacheService.get(`collaborator-notify:window:${key}`))) {
        // Reserve the window before sending, so notifies arriving mid-send buffer behind it.
        await this.cacheService.setDetail(
          `collaborator-notify:window:${key}`,
          true,
          windowTtlSeconds
        );
        return false;
      }
      const pending = current ?? {
        ...params,
        refRecord: { ...refRecord, recordIds: [], recordTitles: [] },
        lastAt: 0,
      };
      pending.refRecord.recordIds = uniq([...pending.refRecord.recordIds, ...refRecord.recordIds]);
      pending.refRecord.recordTitles = [
        ...pending.refRecord.recordTitles,
        ...refRecord.recordTitles.filter(
          (title) => !pending.refRecord.recordTitles.some(({ id }) => id === title.id)
        ),
      ].slice(0, maxCollaboratorNotifyRecordTitles);
      pending.lastAt = Date.now();
      await this.cacheService.setDetail(
        `collaborator-notify:pending:${key}`,
        pending,
        windowTtlSeconds + ms('1m') / 1000
      );
      await this.cacheService.setDetail(
        `collaborator-notify:window:${key}`,
        true,
        windowTtlSeconds
      );
      return true;
    });

    this.scheduleCollaboratorNotifyFlush(key, quietMs);
    if (!buffered) {
      await this.createCollaboratorNotify(params);
    }
  }

  private scheduleCollaboratorNotifyFlush(key: string, delayMs: number) {
    if (this.collaboratorNotifyTimers.has(key)) {
      return;
    }
    this.collaboratorNotifyTimers.add(key);
    const timer = setTimeout(() => void this.flushCollaboratorNotify(key), delayMs);
    timer.unref?.();
  }

  private async flushCollaboratorNotify(key: string): Promise<void> {
    this.collaboratorNotifyTimers.delete(key);
    const quietMs = resolveCollaboratorNotifyQuietMs();
    try {
      const now = Date.now();
      const pending = await this.withCollaboratorNotifyLock(key, async () => {
        const current = await this.cacheService.get(`collaborator-notify:pending:${key}`);
        if (current && now >= current.lastAt + quietMs) {
          await this.cacheService.del(`collaborator-notify:pending:${key}`);
        }
        return current;
      });
      if (!pending) {
        return;
      }
      const { lastAt, ...params } = pending;
      if (now < lastAt + quietMs) {
        this.scheduleCollaboratorNotifyFlush(key, lastAt + quietMs - now);
        return;
      }
      await this.createCollaboratorNotify(params);
    } catch (error) {
      this.logger.error(
        `Error flushing collaborator notifications: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  private async withCollaboratorNotifyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    let result!: T;
    while (
      !(await this.distributedLockService.runExclusive(
        `collaborator-notify:${key}`,
        10,
        async () => {
          result = await task();
        }
      ))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return result;
  }

  private async createCollaboratorNotify(params: ICollaboratorNotifyParams): Promise<boolean> {
    const { fromUserId, toUserId, refRecord } = params;
    const [fromUser, toUser] = await Promise.all([
      this.userService.getUserById(fromUserId),
      this.userService.getUserById(toUserId),
    ]);

    if (!fromUser || !toUser || fromUserId === toUserId) {
      return false;
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
      severity: NotificationSeverityEnum.Info,
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
        url: notifyPath,
        severity: NotificationSeverityEnum.Info,
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
    if (toUser.notifyMeta?.email) {
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
    return true;
  }

  async sendHtmlContentNotify(
    params: {
      path: string;
      fromUserId?: string;
      toUserId: string;
      message: string | ILocalization<I18nPath>;
      severity?: NotificationSeverityEnum;
      emailConfig?: INotifyEmailConfig;
    },
    type = NotificationTypeEnum.System
  ) {
    const { toUserId, emailConfig, path, fromUserId = SYSTEM_USER_ID } = params;
    const notifyId = generateNotificationId();
    const toUser = await this.userService.getUserById(toUserId);
    if (!toUser) {
      return;
    }

    const severity = params.severity ?? this.getNotificationSeverity(type);
    const messageI18n = this.getMessageI18n(params.message);
    const data: Prisma.NotificationCreateInput = {
      id: notifyId,
      fromUserId: fromUserId,
      toUserId,
      type,
      urlPath: path,
      createdBy: fromUserId,
      message: this.getMessage(params.message, 'en'),
      messageI18n,
      severity,
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
        severity,
        isRead: false,
        createdTime: notifyData.createdTime.toISOString(),
      },
      unreadCount: unreadCount,
    };

    this.sendNotifyBySocket(toUser.id, socketNotification);

    if (emailConfig && toUser.notifyMeta?.email) {
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

  /**
   * A notification a third-party OAuth app sends the user who authorized it: sent by the system
   * on the app's behalf (the app's client id is the sender), shown with the app's logo, linking
   * out to `url`, and never emailed. Lands at most once per app, user and `externalId`: the id
   * is derived from the three, so a repeat hits the primary key and changes nothing.
   */
  async sendAppNotify(params: {
    app: { clientId: string; name: string; logo?: string | null };
    toUserId: string;
    externalId: string;
    text: string;
    url?: string;
  }): Promise<'created' | 'duplicate'> {
    const { app, toUserId, externalId, text, url } = params;
    const type = NotificationTypeEnum.OAuthApp;
    const localization: ILocalization<I18nPath> = {
      i18nKey: 'common.notification.oauthApp.message',
      // the Web renders messages as HTML: whatever the app wrote shows as text
      context: { app: escape(app.name), text: escape(text) },
    };
    const severity = this.getNotificationSeverity(type);
    const record = {
      id: appNotificationId(app.clientId, toUserId, externalId),
      fromUserId: app.clientId,
      toUserId,
      type,
      urlPath: url ?? '',
      createdBy: app.clientId,
      message: this.getMessage(localization, 'en'),
      messageI18n: this.getMessageI18n(localization),
      severity,
      createdTime: new Date(),
    };
    const { count } = await this.prismaService.notification.createMany({
      data: [record],
      skipDuplicates: true,
    });
    if (!count) {
      return 'duplicate';
    }

    const { unreadCount } = await this.unreadCount(toUserId);
    this.sendNotifyBySocket(toUserId, {
      notification: {
        id: record.id,
        message: record.message,
        messageI18n: record.messageI18n,
        notifyType: type,
        url: record.urlPath,
        notifyIcon: this.generateNotifyIcon(type, app.clientId, {}, app.logo),
        severity,
        isRead: false,
        createdTime: record.createdTime.toISOString(),
      },
      unreadCount,
    });
    return 'created';
  }

  async sendCommonNotify(
    params: {
      path?: string;
      fromUserId?: string;
      toUserId?: string | string[];
      toEmail?: string | string[];
      message: string | ILocalization<I18nPath>;
      severity?: NotificationSeverityEnum;
      emailConfig?: INotifyEmailConfig;
    },
    type = NotificationTypeEnum.System
  ): Promise<{
    sentCount: number;
    invalidUserIds?: string[];
    invalidEmails?: string[];
  }> {
    const { emailConfig, path = '', fromUserId = SYSTEM_USER_ID } = params;
    const ids = toArray(params.toUserId);
    const emails = toArray(params.toEmail);

    const toUsers = await this.userService.getUsersByIdsOrEmails({ ids, emails });

    const invalidUserIds = ids.length
      ? ids.filter((id) => !toUsers.some((u) => u.id === id))
      : undefined;
    const invalidEmails = emails.length
      ? emails.filter((e) => !toUsers.some((u) => u.email.toLowerCase() === e.toLowerCase()))
      : undefined;

    if (toUsers.length === 0) {
      return { sentCount: 0, invalidUserIds, invalidEmails };
    }

    const severity = params.severity ?? this.getNotificationSeverity(type);
    const messageI18n = this.getMessageI18n(params.message);
    const messageEn = this.getMessage(params.message, 'en');

    const rawUsers = await this.prismaService.user.findMany({
      select: { id: true, name: true, avatar: true },
      where: { id: fromUserId },
    });
    const fromUserSets = keyBy(rawUsers, 'id');
    const notifyIcon = this.generateNotifyIcon(type, fromUserId, fromUserSets);

    const createdTime = new Date();
    const notifyRecords = toUsers.map((toUser) => ({
      id: generateNotificationId(),
      fromUserId,
      toUserId: toUser.id,
      type,
      urlPath: path,
      createdBy: fromUserId,
      message: messageEn,
      messageI18n,
      severity,
      createdTime,
    }));

    const toUserIdList = toUsers.map((u) => u.id);
    const unreadCounts = await this.prismaService.notification.groupBy({
      by: ['toUserId'],
      where: { toUserId: { in: toUserIdList }, isRead: false },
      _count: { _all: true },
    });
    const unreadCountMap = new Map(unreadCounts.map((r) => [r.toUserId, r._count._all]));

    await this.prismaService.notification.createMany({ data: notifyRecords });

    const notifyById = keyBy(notifyRecords, 'toUserId');
    for (const toUser of toUsers) {
      const record = notifyById[toUser.id];
      const unreadCount = (unreadCountMap.get(toUser.id) ?? 0) + 1;

      this.sendNotifyBySocket(toUser.id, {
        notification: {
          id: record.id,
          message: messageEn,
          messageI18n,
          notifyType: type,
          url: path,
          notifyIcon: notifyIcon,
          severity,
          isRead: false,
          createdTime: createdTime.toISOString(),
        },
        unreadCount,
      });

      if (emailConfig && toUser.notifyMeta?.email) {
        const lang = this.getUserLang(toUser.lang);
        const emailOptions = await this.mailSenderService.commonEmailOptions({
          ...emailConfig,
          title: this.getMessage(emailConfig.title, lang),
          message: this.getMessage(emailConfig.message, lang),
          to: toUser.id,
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

    return { sentCount: toUsers.length, invalidUserIds, invalidEmails };
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
      severity: NotificationSeverityEnum.Info,
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
    const isFailed = typeof message === 'string' ? false : message.i18nKey.includes('.failed');

    this.sendHtmlContentNotify(
      {
        path: '',
        toUserId,
        message,
        severity: isFailed ? NotificationSeverityEnum.Warning : NotificationSeverityEnum.Info,
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
        severity: NotificationSeverityEnum.Info,
        emailConfig: {
          title: { i18nKey: 'common.email.templates.notify.recordComment.title' },
          message: message,
        },
      },
      type
    );
  }

  async getNotifyList(userId: string, query: IGetNotifyListQuery): Promise<INotificationVo> {
    const { notifyStates, cursor, severity, notifyType } = query;
    const where: Prisma.NotificationWhereInput = {
      toUserId: userId,
      isRead: notifyStates === NotificationStatesEnum.Read,
    };
    const listWhere: Prisma.NotificationWhereInput = {
      ...where,
      ...(severity ? { severity } : {}),
      ...(notifyType ? { type: notifyType } : {}),
    };

    const [{ records, nextCursor }, summary] = await Promise.all([
      this.getNotificationRecords(listWhere, cursor),
      this.getNotificationListSummary(where),
    ]);

    const notifications = await this.getNotificationListVos(records);
    return {
      notifications,
      nextCursor,
      summary,
    };
  }

  private async getNotificationRecords(
    where: Prisma.NotificationWhereInput,
    cursor?: string | null
  ) {
    const data = await this.prismaService.notification.findMany({
      select: notificationListSelect,
      where,
      take: notificationListLimit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : undefined,
      orderBy: {
        createdTime: 'desc',
      },
    });

    return this.takeNotificationPage(data);
  }

  private takeNotificationPage(records: INotificationListRecord[]) {
    const pageRecords = records.slice(0, notificationListLimit);
    return {
      records: pageRecords,
      nextCursor:
        records.length > notificationListLimit
          ? pageRecords[pageRecords.length - 1]?.id
          : undefined,
    };
  }

  private async getNotificationListSummary(where: Prisma.NotificationWhereInput) {
    const groups = await this.prismaService.notification.groupBy({
      by: ['severity'],
      where,
      _count: { _all: true },
    });

    const result = {
      [NotificationSeverityEnum.Critical]: 0,
      [NotificationSeverityEnum.Warning]: 0,
      [NotificationSeverityEnum.Info]: 0,
    };
    for (const g of groups) {
      result[g.severity as NotificationSeverityEnum] = g._count._all;
    }
    return result;
  }

  private async getNotificationListVos(data: INotificationListRecord[]) {
    const fromUserIds = data.map((v) => v.fromUserId);
    // an app's notifications are sent from its client id
    const clientIds = uniq(
      data.filter((v) => v.type === NotificationTypeEnum.OAuthApp).map((v) => v.fromUserId)
    );
    const [rawUsers, apps] = await Promise.all([
      this.prismaService.user.findMany({
        select: { id: true, name: true, avatar: true },
        where: { id: { in: fromUserIds } },
      }),
      clientIds.length
        ? this.prismaService.oAuthApp.findMany({
            select: { clientId: true, logo: true },
            where: { clientId: { in: clientIds } },
          })
        : [],
    ]);
    const fromUserSets = keyBy(rawUsers, 'id');
    // an app's current logo, so a new one shows on what it sent before too
    const appLogos = new Map(apps.map((app) => [app.clientId, app.logo]));

    return data.map((v) => {
      const notifyIcon = this.generateNotifyIcon(
        v.type as NotificationTypeEnum,
        v.fromUserId,
        fromUserSets,
        appLogos.get(v.fromUserId)
      );
      return {
        id: v.id,
        notifyIcon: notifyIcon,
        notifyType: v.type as NotificationTypeEnum,
        url: v.urlPath || '',
        message: v.message,
        messageI18n: v.messageI18n,
        severity: this.getNotificationSeverity(v.type as NotificationTypeEnum, v.severity),
        isRead: v.isRead,
        createdTime: v.createdTime.toISOString(),
      };
    });
  }

  private generateNotifyIcon(
    notifyType: NotificationTypeEnum,
    fromUserId: string,
    fromUserSets: Record<string, { id: string; name: string; avatar: string | null }>,
    appLogo?: string | null
  ) {
    switch (notifyType) {
      case NotificationTypeEnum.System:
      case NotificationTypeEnum.ExportBase:
      case NotificationTypeEnum.AdminNotice:
        return { iconUrl: systemIconUrl };
      // the logo the sending app registered, stored like any other upload
      case NotificationTypeEnum.OAuthApp:
        return {
          iconUrl: !appLogo
            ? systemIconUrl
            : /^https?:\/\//i.test(appLogo)
              ? appLogo
              : getPublicFullStorageUrl(appLogo),
        };
      case NotificationTypeEnum.Comment:
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag:
      case NotificationTypeEnum.CollaboratorInvite: {
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

  private getNotificationSeverity(
    notifyType: NotificationTypeEnum,
    severity?: string
  ): NotificationSeverityEnum {
    if (
      severity &&
      Object.values(NotificationSeverityEnum).includes(severity as NotificationSeverityEnum)
    ) {
      return severity as NotificationSeverityEnum;
    }

    switch (notifyType) {
      case NotificationTypeEnum.Comment:
      case NotificationTypeEnum.CollaboratorCellTag:
      case NotificationTypeEnum.CollaboratorMultiRowTag:
      case NotificationTypeEnum.ExportBase:
      case NotificationTypeEnum.System:
      case NotificationTypeEnum.AdminNotice:
      case NotificationTypeEnum.CollaboratorInvite:
      case NotificationTypeEnum.OAuthApp:
        return NotificationSeverityEnum.Info;
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
      case NotificationTypeEnum.AdminNotice:
      case NotificationTypeEnum.CollaboratorInvite:
      case NotificationTypeEnum.OAuthApp: // its link arrives complete with the notification
        return '';
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
