import type {
  AppAction,
  AutomationAction,
  BaseAction,
  FieldAction,
  RecordAction,
  TableAction,
  UserAction,
  ViewAction,
} from './actions';

export const OAUTH_ACTIONS: (
  | AppAction
  | BaseAction
  | TableAction
  | ViewAction
  | FieldAction
  | RecordAction
  | UserAction
  | AutomationAction
)[] = [
  'app|create',
  'app|delete',
  'app|read',
  'app|update',
  'base|read',
  'base|read_all',
  'base|update',
  'base|table_import',
  'base|table_export',
  'base|query_data',
  'table|create',
  'table|delete',
  'table|export',
  'table|import',
  'table|read',
  'table|update',
  'table|trash_read',
  'table|trash_update',
  'table|trash_reset',
  'view|create',
  'view|delete',
  'view|read',
  'view|update',
  'field|create',
  'field|delete',
  'field|read',
  'field|update',
  'record|comment',
  'record|create',
  'record|delete',
  'record|read',
  'record|update',
  'automation|create',
  'automation|delete',
  'automation|read',
  'automation|update',
  'user|email_read',
  'user|integrations',
];
