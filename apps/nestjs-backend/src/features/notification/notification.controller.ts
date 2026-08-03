import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import type { INotificationUnreadCountVo, INotificationVo } from '@teable/openapi';
import {
  getNotifyListQuerySchema,
  IGetNotifyListQuery,
  IUpdateNotifyStatusRo,
  updateNotifyStatusRoSchema,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { NotificationService } from './notification.service';

@Controller('api/notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly cls: ClsService<IClsStore>
  ) {}

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
