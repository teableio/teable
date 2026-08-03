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

  BASE_NODE_CREATE = 'base.node.create',
  BASE_NODE_DELETE = 'base.node.delete',
  BASE_NODE_UPDATE = 'base.node.update',

  TABLE_CREATE = 'table.create',
  TABLE_DELETE = 'table.delete',
  TABLE_UPDATE = 'table.update',

  TABLE_FIELD_CREATE = 'table.field.create',
  TABLE_FIELD_DELETE = 'table.field.delete',
  TABLE_FIELD_UPDATE = 'table.field.update',

  TABLE_RECORD_CREATE = 'table.record.create',
  TABLE_RECORD_DELETE = 'table.record.delete',
  TABLE_RECORD_UPDATE = 'table.record.update',

  TABLE_BUTTON_CLICK = 'table.button.click',

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
  SHARED_VIEW_REFRESH = 'shared.view.refresh',

  USER_SIGNIN = 'user.signin',
  USER_SIGNUP = 'user.signup',
  USER_RENAME = 'user.rename',
  USER_SIGNOUT = 'user.signout',
  USER_DELETE = 'user.delete',

  // USER_PASSWORD_RESET = 'user.password.reset',
  USER_PASSWORD_CHANGE = 'user.password.change',
  // USER_PASSWORD_FORGOT = 'user.password.forgot'
  USER_EMAIL_CHANGE = 'user.email.change',

  COLLABORATOR_CREATE = 'collaborator.create',
  COLLABORATOR_DELETE = 'collaborator.delete',
  COLLABORATOR_UPDATE = 'collaborator.update',

  // Base-scope collaborator audit actions (parallel to the generic COLLABORATOR_*
  // business events above, which are kept for internal pub/sub). Future space-level
  // audit can mirror this with SPACE_COLLABORATOR_*.
  BASE_COLLABORATOR_CREATE = 'base.collaborator.create',
  BASE_COLLABORATOR_DELETE = 'base.collaborator.delete',
  BASE_COLLABORATOR_UPDATE = 'base.collaborator.update',

  // Base/Node share lifecycle (covers both node-scoped and base-wide shares;
  // payload.type distinguishes 'node' | 'base').
  BASE_SHARE_CREATE = 'base.share.create',
  BASE_SHARE_UPDATE = 'base.share.update',
  BASE_SHARE_DELETE = 'base.share.delete',
  BASE_SHARE_REFRESH = 'base.share.refresh',

  BASE_FOLDER_CREATE = 'base.folder.create',
  BASE_FOLDER_DELETE = 'base.folder.delete',
  BASE_FOLDER_UPDATE = 'base.folder.update',

  DASHBOARD_CREATE = 'dashboard.create',
  DASHBOARD_DELETE = 'dashboard.delete',
  DASHBOARD_UPDATE = 'dashboard.update',

  WORKFLOW_CREATE = 'workflow.create',
  WORKFLOW_DELETE = 'workflow.delete',
  WORKFLOW_UPDATE = 'workflow.update',
  WORKFLOW_ACTIVATE = 'workflow.activate',
  WORKFLOW_DEACTIVATE = 'workflow.deactivate',

  APP_CREATE = 'app.create',
  APP_DELETE = 'app.delete',
  APP_UPDATE = 'app.update',

  CROP_IMAGE = 'crop.image',
  CROP_IMAGE_COMPLETE = 'crop.image.complete',

  RECORD_HISTORY_CREATE = 'record.history.create',

  // following make no sense just for testing
  BASE_EXPORT_COMPLETE = 'base.export.complete',

  // Fired once per import job at terminal state (success or failure). Lets e2e tests
  // and downstream consumers (notifications, webhooks) wait on the worker's true
  // completion point — past `lastChunk`, error-file write, and presence cleanup —
  // instead of racing against per-chunk audit emits.
  TABLE_IMPORT_FINISH = 'table.import.finish',
  V2_TABLE_IMPORT_FINISH = 'v2.table.import.finish',

  // Composite-operation terminal signals. Currently only e2e tests subscribe; reserved
  // for future use by notifications / webhooks / billing. Each fires after the synchronous
  // path of the operation finishes (transaction committed, scope closed). Per-row audit
  // emits inside the operation are fire-and-forget, so subscribers that want all audit
  // rows in DB still need a short poll after the event.
  BASE_DUPLICATE_COMPLETE = 'base.duplicate.complete',
  BASE_TEMPLATE_APPLY_COMPLETE = 'base.template.apply.complete',
  BASE_SHARE_COPY_COMPLETE = 'base.share.copy.complete',

  LAST_VISIT_CLEAR = 'last.visit.clear',
  LAST_VISIT_UPDATE = 'last.visit.update',

  // Internal event fired by `AuditScope.emitAtomic()` for both record-related
  // emissions (chunked imports, raw-SQL ops) and atomic events (user.signin, token
  // create/delete, invitations). The listener `AuditLogListener.handleAuditLogEmit`
  // writes one audit_log row per emit.
  AUDIT_LOG_EMIT = 'audit-log.emit',

  NOTIFY_MAIL_MERGE = 'notify.mail.merge',

  // Invitation funnel
  INVITATION_EMAIL_SEND = 'invitation.email.send',
  INVITATION_LINK_CREATE = 'invitation.link.create',
  INVITATION_ACCEPT = 'invitation.accept',

  // Access token lifecycle
  ACCESS_TOKEN_CREATE = 'access-token.create',
  ACCESS_TOKEN_DELETE = 'access-token.delete',

  // Table export
  TABLE_EXPORT = 'table.export',
}
