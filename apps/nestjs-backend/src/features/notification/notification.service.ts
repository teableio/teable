import { Injectable, Logger } from '@nestjs/common';
import type { NotificationTypeEnum, INotificationSocketVo } from '@teable-group/core';
import { NotificationStatesEnum, getUserNotificationChannel } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type {
  IGetNotifyListQuery,
  INotificationVo,
  IUpdateNotifyStatusRo,
  INotificationUnreadCountVo,
} from '@teable-group/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IClsStore } from '../../types/cls';
import { MailSenderService } from '../mail-sender/mail-sender.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly shareDbService: ShareDbService,
    private readonly mailSenderService: MailSenderService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async sendNotify(params: {
    toUserId: string;
    fromUserId: string;
    notifyType: NotificationTypeEnum;
    notifyTplId: string;
  }) {
    return null;
  }

  private async sendNotifyBySocket(toUserId: string, data: INotificationSocketVo) {
    const channel = getUserNotificationChannel(toUserId);

    const presence = this.shareDbService.connect().getPresence(channel);
    const localPresence = presence.create(data.notification.id);

    localPresence.submit(data, (error) => {
      error && this.logger.error(error);
    });
  }

  private async sendNotifyByMail() {
    await this.mailSenderService.sendMail({});
  }

  async getNotifyList(query: IGetNotifyListQuery & { limit?: number }): Promise<INotificationVo> {
    const currentUserId = this.cls.get('user.id');
    const { notifyStates, offset, limit = 5 } = query;

    const data = await this.prismaService.txClient().notification.findMany({
      where: {
        toUser: currentUserId,
        isRead: notifyStates === NotificationStatesEnum.Read,
      },
      take: limit,
      skip: offset,
      orderBy: {
        createdTime: 'desc',
      },
    });

    const totalCount = await this.prismaService.txClient().notification.count({
      where: {
        toUser: currentUserId,
        isRead: notifyStates === NotificationStatesEnum.Read,
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

    return {
      notifications: notifications,
      totalCount: totalCount,
    };
  }

  async unreadCount(userId?: string): Promise<INotificationUnreadCountVo> {
    const currentUserId = userId ?? this.cls.get('user.id');

    const unreadCount = await this.prismaService.txClient().notification.count({
      where: {
        toUser: currentUserId,
        isRead: false,
      },
    });
    return { unreadCount };
  }

  async updateNotifyStatus(
    notificationId: string,
    updateNotifyStatusRo: IUpdateNotifyStatusRo
  ): Promise<void> {
    const { isRead } = updateNotifyStatusRo;

    const currentUserId = this.cls.get('user.id');
    await this.prismaService.txClient().notification.updateMany({
      where: {
        id: notificationId,
        toUser: currentUserId,
      },
      data: {
        isRead: isRead,
      },
    });
  }

  async markAllAsRead(): Promise<void> {
    const currentUserId = this.cls.get('user.id');
    await this.prismaService.txClient().notification.updateMany({
      where: {
        toUser: currentUserId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });
  }
}
