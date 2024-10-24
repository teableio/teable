/* eslint-disable @typescript-eslint/naming-convention */
export enum Events {
  SPACE_CREATE = 'space.create',
  SPACE_DELETE = 'space.delete',
  SPACE_UPDATE = 'space.update',

  BASE_CREATE = 'base.create',
  BASE_DELETE = 'base.delete',
  BASE_UPDATE = 'base.update',
  BASE_PERMISSION_UPDATE = 'base.permission.update',
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

  OPERATION_RECORDS_CREATE = 'operation.records.create',
  OPERATION_RECORDS_DELETE = 'operation.records.delete',
  OPERATION_RECORDS_UPDATE = 'operation.records.update',
  OPERATION_RECORDS_ORDER_UPDATE = 'operation.records.order.update',
  OPERATION_FIELDS_CREATE = 'operation.fields.create',
  OPERATION_FIELDS_DELETE = 'operation.fields.delete',
  OPERATION_FIELD_CONVERT = 'operation.field.convert',
  OPERATION_PASTE_SELECTION = 'operation.paste.selection',
  OPERATION_VIEW_DELETE = 'operation.view.delete',
  OPERATION_VIEW_CREATE = 'operation.view.create',
  OPERATION_VIEW_UPDATE = 'operation.view.update',
  OPERATION_PUSH = 'operation.push',

  TABLE_USER_RENAME_COMPLETE = 'table.user.rename.complete',

  SHARED_VIEW_CREATE = 'shared.view.create',
  SHARED_VIEW_DELETE = 'shared.view.delete',
  SHARED_VIEW_UPDATE = 'shared.view.update',

  USER_SIGNIN = 'user.signin',
  USER_SIGNUP = 'user.signup',
  USER_RENAME = 'user.rename',
  USER_SIGNOUT = 'user.signout',
  USER_DELETE = 'user.delete',

  // USER_PASSWORD_RESET = 'user.password.reset',
  USER_PASSWORD_CHANGE = 'user.password.change',
  // USER_PASSWORD_FORGOT = 'user.password.forgot'

  COLLABORATOR_CREATE = 'collaborator.create',
  COLLABORATOR_DELETE = 'collaborator.delete',

  WORKFLOW_ACTIVATE = 'workflow.activate',
  WORKFLOW_DEACTIVATE = 'workflow.deactivate',

  CROP_IMAGE = 'crop.image',
}
