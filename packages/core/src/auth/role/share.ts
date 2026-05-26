/* eslint-disable @typescript-eslint/naming-convention */
import type { Action, FieldAction, RecordAction, ViewAction } from '../actions';
import { TemplatePermissions } from './template';

export type ShareViewAction = ViewAction | FieldAction | RecordAction;

/**
 * Permissions granted by a view share link with no allowEdit
 * (or when the viewer is anonymous even if allowEdit is on).
 * Mirrors TemplatePermissions — pure read access.
 */
export const ShareViewReadOnlyPermissions: Action[] = TemplatePermissions;

/**
 * Permissions granted when shareMeta.allowEdit is on and the viewer is logged in.
 * Full record CRUD inside the shared view's table — same shape as base-share
 * allowEdit. Field/view/base/table mutations, comments, sharing, and invite are
 * deliberately excluded so they cannot be reached via a share link.
 *
 * Resource scoping (tableId must match the shared view's table) is enforced in
 * PermissionService.checkResourceBelongsToShareView. Stricter view-level
 * scoping (only records inside the view's filter, only visible fields) is
 * enforced before common record/selection writes.
 */
export const ShareViewEditPermissions: Action[] = [
  ...TemplatePermissions,
  'record|create',
  'record|update',
  'record|delete',
];
