/* eslint-disable @typescript-eslint/naming-convention */
export enum Events {
  SPACE_CREATE = 'space.create',
  SPACE_DELETE = 'space.delete',
  SPACE_UPDATE = 'space.update',

  BASE_CREATE = 'base.create',
  BASE_DELETE = 'base.delete',
  BASE_UPDATE = 'base.update',
  // BASE_CLONE = 'base.clone',
  // BASE_MOVE = 'base.move',

  TABLE_CREATE = 'table.create',
  TABLE_DELETE = 'table.delete',
  TABLE_UPDATE = 'table.update',

  TABLE_FIELD_CREATE = 'table.field.create',
  TABLE_FIELD_DELETE = 'table.field.delete',
  TABLE_FIELD_UPDATE = 'table.field.update',

  TABLE_RECORD_CREATE = 'table.record.create',
  TABLE_RECORD_DELETE = 'table.record.delete',
  TABLE_RECORD_UPDATE = 'table.record.update',

  TABLE_VIEW_CREATE = 'table.view.create',
  TABLE_VIEW_DELETE = 'table.view.delete',
  TABLE_VIEW_UPDATE = 'table.view.update',

  SHARED_VIEW_CREATE = 'shared.view.create',
  SHARED_VIEW_DELETE = 'shared.view.delete',
  SHARED_VIEW_UPDATE = 'shared.view.update',

  USER_SIGNIN = 'user.signin',
  USER_SIGNUP = 'user.signup',
  USER_SIGNOUT = 'user.signout',
  USER_UPDATE = 'user.update',
  USER_DELETE = 'user.delete',

  // USER_PASSWORD_RESET = 'user.password.reset',
  USER_PASSWORD_CHANGE = 'user.password.change',
  // USER_PASSWORD_FORGOT = 'user.password.forgot'
}
