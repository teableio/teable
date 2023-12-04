import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { INotificationSocketVo } from '@teable-group/core';
import { getUserNotificationChannel } from '@teable-group/core';
import { FieldService } from '../../features/field/field.service';
import { NotificationService } from '../../features/notification/notification.service';
import { ShareDbService } from '../../share-db/share-db.service';
import type { IBaseEvent } from '../interfaces/base-event.interface';

@Injectable()
export class NotificationListener {
  private readonly logger = new Logger(NotificationListener.name);

  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly fieldService: FieldService,
    private readonly notificationService: NotificationService
  ) {}

  @OnEvent('table.record.*', { async: true })
  private async listener(events: IBaseEvent | IBaseEvent[]): Promise<void> {
    // if (event.name === Events.TABLE_RECORD_UPDATE) {
    //   const { tableId, newFields } = event as RecordUpdateEvent;
    //   const fieldIds = Object.keys(newFields);
    //
    //   const fieldVos = await this.fieldService.getFieldsById(tableId, fieldIds);
    //
    //   const iFieldVos = fieldVos.filter((field) => field.type === FieldType.User);
    //
    //   if (iFieldVos) {
    //     for (const value of iFieldVos) {
    //       const { id: userId } = newFields[value.id] as IUserCellValue;
    //
    //       const { unreadCount } = await this.notificationService.unreadCount(userId);
    //
    //       this.sendNotifyBySocket(userId, {
    //         notification: {
    //           id: generateNotificationId(),
    //           message: '第一条测试消息',
    //           notifyIcon: { iconUrl: 'https://iconUrl' },
    //           notifyType: NotificationTypeEnum.CollaboratorCellTag,
    //           url: 'https://url',
    //           isRead: false,
    //           createdTime: new Date().toISOString(),
    //         },
    //         unreadCount: unreadCount + randomInt(100),
    //       });
    //     }
    //   }
    // }
  }

  // private sendNotifyBySocket(toUserId: string, data: INotificationSocketVo) {
  //   const channel = getUserNotificationChannel(toUserId);
  //
  //   const presence = this.shareDbService.connect().getPresence(channel);
  //   const localPresence = presence.create(data.notification.id);
  //
  //   localPresence.submit(data, (error) => {
  //     error && this.logger.error(error);
  //   });
  // }
}
