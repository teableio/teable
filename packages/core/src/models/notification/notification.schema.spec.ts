import { NotificationSeverityEnum, NotificationTypeEnum } from './notification.enum';
import { notificationSchema } from './notification.schema';

describe('notificationSchema', () => {
  it('accepts notification severity for backend-driven grouping', () => {
    const result = notificationSchema.parse({
      id: 'notabcdefghijklmnop',
      notifyIcon: { iconUrl: '/images/favicon/favicon.svg' },
      notifyType: NotificationTypeEnum.System,
      url: '/space/spc123/setting/plan',
      message: 'Space credits 90% used',
      messageI18n: null,
      severity: NotificationSeverityEnum.Warning,
      isRead: false,
      createdTime: new Date().toISOString(),
    });

    expect(result.severity).toBe(NotificationSeverityEnum.Warning);
  });
});
