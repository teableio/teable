/* eslint-disable @typescript-eslint/naming-convention */
import type { FieldActions, RecordActions, ViewActions } from '../actions';

export const shareViewPermission: Record<ViewActions | FieldActions | RecordActions, boolean> = {
  'view|create': false,
  'view|delete': false,
  'view|read': true,
  'view|update': false,
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
