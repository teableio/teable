/* eslint-disable @typescript-eslint/naming-convention */
import type { FieldAction, RecordAction, ViewAction } from '../actions';

export type ShareViewAction = ViewAction | FieldAction | RecordAction;

export const shareViewPermissions: Record<ShareViewAction, boolean> = {
  'view|create': false,
  'view|delete': false,
  'view|read': true,
  'view|update': false,
  'view|share': false,
  'field|create': false,
  'field|delete': false,
  'field|read': true,
  'field|update': false,
  'record|create': false,
  'record|comment': false,
  'record|delete': false,
  'record|read': true,
  'record|update': false,
};
