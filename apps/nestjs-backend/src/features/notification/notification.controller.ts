import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type {
  ICreateAppNotificationVo,
  INotificationUnreadCountVo,
  INotificationVo,
} from '@teable/openapi';
import {
  createAppNotificationRoSchema,
  getNotifyListQuerySchema,
  ICreateAppNotificationRo,
  IGetNotifyListQuery,
  IUpdateNotifyStatusRo,
  updateNotifyStatusRoSchema,
} from '@teable/openapi';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AppNotificationService, AppNotifyRateLimitedException } from './app-notification.service';
import { NotificationService } from './notification.service';

@Controller('api/notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly appNotificationService: AppNotificationService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /** A third-party OAuth app notifying the user its access token belongs to. */
  @Post()
  @Permissions('user|notifications_send')
  async createAppNotification(
    @Body(new ZodValidationPipe(createAppNotificationRoSchema)) ro: ICreateAppNotificationRo,
    @Res({ passthrough: true }) res: Response
  ): Promise<ICreateAppNotificationVo> {
    try {
      return await this.appNotificationService.send(ro);
    } catch (error) {
      if (error instanceof AppNotifyRateLimitedException) {
        res.setHeader('Retry-After', String(error.retryAfter));
      }
      throw error;
    }
  }

  @Get()
  async getNotifyList(
    @Query(new ZodValidationPipe(getNotifyListQuerySchema)) query: IGetNotifyListQuery
  ): Promise<INotificationVo> {
    const currentUserId = this.cls.get('user.id');
    return this.notificationService.getNotifyList(currentUserId, query);
  }

  @Get('/unread-count')
  async unreadCount(): Promise<INotificationUnreadCountVo> {
    const currentUserId = this.cls.get('user.id');
    return this.notificationService.unreadCount(currentUserId);
  }

  @Patch(':notificationId/status')
  async updateNotifyStatus(
    @Param('notificationId') notificationId: string,
    @Body(new ZodValidationPipe(updateNotifyStatusRoSchema))
    updateNotifyStatusRo: IUpdateNotifyStatusRo
  ): Promise<void> {
    const currentUserId = this.cls.get('user.id');
    return this.notificationService.updateNotifyStatus(
      currentUserId,
      notificationId,
      updateNotifyStatusRo
    );
  }

  @Patch('/read-all')
  async markAllAsRead(): Promise<void> {
    const currentUserId = this.cls.get('user.id');
    return this.notificationService.markAllAsRead(currentUserId);
  }
}
