export enum NotificationTypeEnum {
  System = 'system',
  CollaboratorCellTag = 'collaboratorCellTag',
  CollaboratorMultiRowTag = 'collaboratorMultiRowTag',
  Comment = 'comment',
  ExportBase = 'exportBase',
  AdminNotice = 'adminNotice',
  CollaboratorInvite = 'collaboratorInvite',
  // sent by a third-party OAuth app to the user who authorized it; links out to the app
  OAuthApp = 'oauthApp',
}

export enum NotificationStatesEnum {
  Unread = 'unread',
  Read = 'read',
}

export enum NotificationSeverityEnum {
  Critical = 'critical',
  Warning = 'warning',
  Info = 'info',
}
