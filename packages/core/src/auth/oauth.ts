import type {
  AutomationActions,
  FieldActions,
  RecordActions,
  TableActions,
  UserActions,
  ViewActions,
} from './actions';

export const OAUTH_ACTIONS: (
  | TableActions
  | ViewActions
  | FieldActions
  | RecordActions
  | UserActions
  | AutomationActions
)[] = [
  'table|create',
  'table|delete',
  'table|export',
  'table|import',
  'table|read',
  'table|update',
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
];
