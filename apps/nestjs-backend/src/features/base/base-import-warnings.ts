import { NotificationSeverityEnum } from '@teable/core';
import type { NotificationService } from '../notification/notification.service';

export interface IBaseImportWarnings {
  skippedUserCells: number;
  skippedLinkCells: number;
  relaxedRequiredUserFields: number;
}

export const notifyBaseImportWarnings = async (
  notificationService: NotificationService,
  baseId: string,
  userId: string,
  warnings: IBaseImportWarnings
): Promise<void> => {
  if (warnings.skippedUserCells > 0 || warnings.skippedLinkCells > 0) {
    await notificationService.sendCommonNotify({
      path: `/base/${baseId}`,
      toUserId: userId,
      severity: NotificationSeverityEnum.Warning,
      message: {
        i18nKey: 'common.notification.baseImport.skippedCells',
        context: {
          skippedUserCells: warnings.skippedUserCells,
          skippedLinkCells: warnings.skippedLinkCells,
        },
      },
    });
  }
  if (warnings.relaxedRequiredUserFields > 0) {
    await notificationService.sendCommonNotify({
      path: `/base/${baseId}`,
      toUserId: userId,
      severity: NotificationSeverityEnum.Warning,
      message: {
        i18nKey: 'common.notification.baseImport.relaxedRequiredUserFields',
        context: { count: warnings.relaxedRequiredUserFields },
      },
    });
  }
};

export const notifyBaseImportFailure = async (
  notificationService: NotificationService,
  baseId: string,
  userId: string
): Promise<void> => {
  await notificationService.sendCommonNotify({
    path: `/base/${baseId}`,
    toUserId: userId,
    severity: NotificationSeverityEnum.Warning,
    message: { i18nKey: 'common.notification.baseImport.failed' },
  });
};
