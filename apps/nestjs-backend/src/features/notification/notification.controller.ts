import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { INotificationVo, INotificationUnreadCountVo } from '@teable-group/openapi';
import {
  getNotifyListQuerySchema,
  IGetNotifyListQuery,
  IUpdateNotifyStatusRo,
  updateNotifyStatusRoSchema,
} from '@teable-group/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { NotificationService } from './notification.service';

@Controller('api/notifications')
@UseGuards(PermissionGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getNotifyList(
    @Query(new ZodValidationPipe(getNotifyListQuerySchema)) query: IGetNotifyListQuery
  ): Promise<INotificationVo> {
    return await this.notificationService.getNotifyList(query);
  }

  @Get('/unreadCount')
  async unreadCount(): Promise<INotificationUnreadCountVo> {
    return this.notificationService.unreadCount();
  }

  @Patch(':notificationId/status')
  async updateNotifyStatus(
    @Param('notificationId') notificationId: string,
    @Body(new ZodValidationPipe(updateNotifyStatusRoSchema))
    updateNotifyStatusRo: IUpdateNotifyStatusRo
  ): Promise<void> {
    return await this.notificationService.updateNotifyStatus(notificationId, updateNotifyStatusRo);
  }

  @Patch('/readAll')
  async markAllAsRead(): Promise<void> {
    return this.notificationService.markAllAsRead();
  }
}
