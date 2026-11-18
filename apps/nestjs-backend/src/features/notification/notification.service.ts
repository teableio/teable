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
  type INotificationSummaryVo,
  type INotificationUnreadCountVo,
  type INotificationVo,
  type IUpdateNotifyStatusRo,
} from '@teable/openapi';
import { escape, keyBy, mapValues, uniq, uniqBy } from 'lodash';
import ms from 'ms';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { IMailConfig, MailConfig } from '../../configs/mail.config';
import { ShareDbService } from '../../share-db/share-db.service';
import type { I18nPath, I18nTranslations } from '../../types/i18n.generated';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { CoalesceMode, CoalesceService } from '../coalesce/coalesce.service';
import { MailMergeGroup, type ISendMailOptions } from '../mail-sender/mail-helpers';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { UserService } from '../user/user.service';

type INotifyEmailConfig = {
  title: string | ILocalization<I18nPath>;
  message: string | ILocalization<I18nPath>;
  buttonUrl?: string;
  buttonText?: string | ILocalization<I18nPath>;
  mergeGroup?: MailMergeGroup;
  /** The message is markup of its own (report links) rather than plain text. */
  htmlBody?: boolean;
};

function toArray<T>(value?: T | T[]): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const notificationListLimit = 10;

// Collaborator notifies from one actor to one user in one table coalesce: a notify with
// no open window is sent at once and opens one, later ones buffer behind it and go out as
// one notification once writes stay quiet.
const COLLABORATOR_NOTIFY_SCOPE = 'collaborator-notify';
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

/** Buffered notifies to one user from one actor in one table, as the one notify they become. */
const mergeCollaboratorNotifies = (
  notifies: ICollaboratorNotifyParams[]
): ICollaboratorNotifyParams => {
  const [first] = notifies;
  const recordTitles = uniqBy(
    notifies.flatMap(({ refRecord }) => refRecord.recordTitles),
    'id'
  );
  return {
    ...first,
    refRecord: {
      ...first.refRecord,
      recordIds: uniq(notifies.flatMap(({ refRecord }) => refRecord.recordIds)),
      recordTitles: recordTitles.slice(0, maxCollaboratorNotifyRecordTitles),
    },
  };
};

type INotifyRecord = {
  id: string;
  fromUserId: string;
  toUserId: string;
  type: NotificationTypeEnum;
  urlPath: string;
  createdBy: string;
  message: string;
  messageI18n?: string;
  severity: NotificationSeverityEnum;
  createdTime: Date;
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
  // Which merge window a notification's mail joins; collaborator tags and export results go
  // out on their own.
  private readonly mailMergeGroupMap: Record<NotificationTypeEnum, MailMergeGroup | undefined> = {
    [NotificationTypeEnum.System]: MailMergeGroup.Default,
    [NotificationTypeEnum.CollaboratorCellTag]: undefined,
    [NotificationTypeEnum.CollaboratorMultiRowTag]: undefined,
    [NotificationTypeEnum.Comment]: MailMergeGroup.Default,
    [NotificationTypeEnum.ExportBase]: undefined,
    [NotificationTypeEnum.AdminNotice]: MailMergeGroup.Default,
    [NotificationTypeEnum.CollaboratorInvite]: MailMergeGroup.Default,
    [NotificationTypeEnum.OAuthApp]: undefined,
  };
  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly mailSenderService: MailSenderService,
    private readonly userService: UserService,
    @MailConfig() private readonly mailConfig: IMailConfig,
    private readonly i18n: I18nService<I18nTranslations>,
    private readonly coalesceService: CoalesceService
  ) {
    this.coalesceService.onFlush<ICollaboratorNotifyParams>(
      COLLABORATOR_NOTIFY_SCOPE,
      async (_key, notifies) => {
        await this.createCollaboratorNotify(mergeCollaboratorNotifies(notifies));
      },
      // Buffered as the one notify the batch becomes, however long writes keep coming
      (notifies) => [mergeCollaboratorNotifies(notifies)]
    );
  }

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
   * Same as getMessage for the html mail body: the mail partials render the
   * message unescaped so a template can carry its own markup (report links),
   * which means the user-supplied names in the i18n context must be escaped.
   * A plain string is passed through untouched, as it may be markup by design.
   */
  getEmailMessage(text: string | ILocalization<I18nPath>, lang?: string) {
    return typeof text === 'string'
      ? text
      : this.getMessage(
          {
            ...text,
            context: mapValues(text.context, (value) =>
              typeof value === 'string' ? escape(value) : value
            ),
          },
          lang
        );
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
    const opened =
      quietMs <= 0 ||
      (await this.coalesceService.add(
        COLLABORATOR_NOTIFY_SCOPE,
        `${fromUserId}:${toUserId}:${refRecord.tableId}`,
        params,
        { mode: CoalesceMode.Quiet, windowMs: quietMs }
      ));
    if (opened) {
      await this.createCollaboratorNotify(params);
    }
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
    await this.deliverNotifies(
      [
        {
          id: notifyId,
          fromUserId,
          toUserId,
          type,
          message: this.getMessage(message, 'en'),
          messageI18n: this.getMessageI18n(message),
          severity: NotificationSeverityEnum.Info,
          urlPath: notifyPath,
          createdBy: fromUserId,
          createdTime: new Date(),
        },
      ],
      userIcon
    );

    if (toUser.notifyMeta?.email) {
      // The notification is written: a mail that fails to build must not fail a flush into a
      // retry that writes it again
      try {
        const emailOptions = await this.mailSenderService.collaboratorCellTagEmailOptions({
          notifyId,
          fromUserName: fromUser.name,
          refRecord,
        });
        this.mailNotify(toUser.email, type, emailOptions);
      } catch (error) {
        this.logger.error(`collaborator notify ${notifyId} mail not sent: ${String(error)}`);
      }
    }
    return true;
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
    const count = await this.deliverNotifies(
      [
        {
          id: appNotificationId(app.clientId, toUserId, externalId),
          fromUserId: app.clientId,
          toUserId,
          type,
          urlPath: url ?? '',
          createdBy: app.clientId,
          message: this.getMessage(localization, 'en'),
          messageI18n: this.getMessageI18n(localization),
          severity: this.getNotificationSeverity(type),
          createdTime: new Date(),
        },
      ],
      this.generateNotifyIcon(type, app.clientId, {}, app.logo),
      { skipDuplicates: true }
    );
    return count ? 'created' : 'duplicate';
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
    await this.deliverNotifies(
      toUsers.map((toUser) => ({
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
      })),
      notifyIcon
    );

    for (const toUser of toUsers) {
      if (emailConfig && toUser.notifyMeta?.email) {
        const lang = this.getUserLang(toUser.lang);
        const mailInfo = {
          title: this.getEmailMessage(emailConfig.title, lang),
          message: this.getEmailMessage(emailConfig.message, lang),
          to: toUser.id,
          buttonUrl: emailConfig.buttonUrl || this.mailConfig.origin + path,
          buttonText: emailConfig.buttonText
            ? this.getMessage(emailConfig.buttonText, lang)
            : this.i18n.t('common.email.templates.notify.buttonText'),
        };
        const emailOptions = emailConfig.htmlBody
          ? await this.mailSenderService.htmlEmailOptions(mailInfo)
          : await this.mailSenderService.commonEmailOptions(mailInfo);
        this.mailNotify(toUser.email, type, emailOptions, emailConfig.mergeGroup);
      }
    }

    return { sentCount: toUsers.length, invalidUserIds, invalidEmails };
  }

  /**
   * Every notification lands the same way: the rows are written, then each recipient's open
   * tabs are told, with an unread count read after the write. Returns how many rows were
   * written: with `skipDuplicates`, none for an id that is taken, and nothing is pushed.
   */
  private async deliverNotifies(
    records: INotifyRecord[],
    notifyIcon: INotificationBuffer['notification']['notifyIcon'],
    options: { skipDuplicates?: boolean } = {}
  ): Promise<number> {
    const { count } = await this.prismaService.notification.createMany({
      data: records,
      skipDuplicates: options.skipDuplicates,
    });
    if (!count) {
      return 0;
    }

    // The rows are the notification: once written, a failure telling open tabs is logged and
    // not thrown, so a retried caller (a coalesce flush) does not write them a second time.
    // Counted after the write, so notifications landing at once each push a count that holds.
    let unreadCountMap: Map<string, number>;
    try {
      const unreadCounts = await this.prismaService.notification.groupBy({
        by: ['toUserId'],
        where: { toUserId: { in: uniq(records.map((r) => r.toUserId)) }, isRead: false },
        _count: { _all: true },
      });
      unreadCountMap = new Map(unreadCounts.map((r) => [r.toUserId, r._count._all]));
    } catch (error) {
      this.logger.warn(`notifications written but not pushed: ${String(error)}`);
      return count;
    }

    for (const record of records) {
      this.sendNotifyBySocket(record.toUserId, {
        notification: {
          id: record.id,
          message: record.message,
          messageI18n: record.messageI18n,
          notifyType: record.type,
          url: record.urlPath,
          notifyIcon,
          severity: record.severity,
          isRead: false,
          createdTime: record.createdTime.toISOString(),
        },
        unreadCount: unreadCountMap.get(record.toUserId) ?? 0,
      });
    }
    return count;
  }

  /** A notification's mail, on the merge window its type joins unless the sender names one. */
  private mailNotify(
    to: string,
    type: NotificationTypeEnum,
    mailOptions: ISendMailOptions,
    mergeGroup = this.mailMergeGroupMap[type]
  ) {
    this.mailSenderService.sendMail(
      { to, ...mailOptions, mergeGroup },
      {
        type: this.mailTypeMap[type],
        transporterName: MailTransporterType.Notify,
      }
    );
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

    this.sendCommonNotify(
      {
        path: '',
        toUserId,
        message,
        severity: isFailed ? NotificationSeverityEnum.Warning : NotificationSeverityEnum.Info,
        emailConfig: {
          title: { i18nKey: 'common.email.templates.notify.exportBase.title' },
          message: message,
          htmlBody: true,
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

  /** The badge count and the unread rows the app surfaces outside the list, in one round trip. */
  async getNotifySummary(userId: string): Promise<INotificationSummaryVo> {
    const unread = { toUserId: userId, isRead: false };
    const [{ unreadCount }, criticalAdmin, invites] = await Promise.all([
      this.unreadCount(userId),
      this.getNotificationRecords({
        ...unread,
        severity: NotificationSeverityEnum.Critical,
        type: NotificationTypeEnum.AdminNotice,
      }),
      this.getNotificationRecords({ ...unread, type: NotificationTypeEnum.CollaboratorInvite }),
    ]);
    const vos = await this.getNotificationListVos([...criticalAdmin.records, ...invites.records]);
    return {
      unreadCount,
      criticalAdminNotices: vos.slice(0, criticalAdmin.records.length),
      unreadInvites: vos.slice(criticalAdmin.records.length),
    };
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
