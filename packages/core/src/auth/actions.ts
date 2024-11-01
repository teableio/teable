/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';

export enum ActionPrefix {
  Space = 'space',
  Base = 'base',
  Table = 'table',
  View = 'view',
  Record = 'record',
  Field = 'field',
  Automation = 'automation',
  User = 'user',
  TableRecordHistory = 'table_record_history',
  Instance = 'instance',
}

export const spaceActions = [
  'space|create',
  'space|delete',
  'space|read',
  'space|update',
  'space|invite_email',
  'space|invite_link',
  'space|grant_role',
] as const;
export const spaceActionSchema = z.enum(spaceActions);
export type SpaceAction = z.infer<typeof spaceActionSchema>;

export const baseActions = [
  'base|create',
  'base|delete',
  'base|read',
  'base|update',
  'base|invite_email',
  'base|invite_link',
  'base|table_import',
  'base|table_export',
  'base|authority_matrix_config',
  'base|db_connection',
  'base|query_data',
] as const;
export const baseActionSchema = z.enum(baseActions);
export type BaseAction = z.infer<typeof baseActionSchema>;

export const tableActions = [
  'table|create',
  'table|delete',
  'table|read',
  'table|update',
  'table|import',
  'table|export',
] as const;
export const tableActionSchema = z.enum(tableActions);
export type TableAction = z.infer<typeof tableActionSchema>;

export const viewActions = [
  'view|create',
  'view|delete',
  'view|read',
  'view|update',
  'view|share',
] as const;
export const viewActionSchema = z.enum(viewActions);
export type ViewAction = z.infer<typeof viewActionSchema>;

export const fieldActions = ['field|create', 'field|delete', 'field|read', 'field|update'] as const;
export const fieldActionSchema = z.enum(fieldActions);
export type FieldAction = z.infer<typeof fieldActionSchema>;

export const recordActions = [
  'record|create',
  'record|delete',
  'record|read',
  'record|update',
  'record|comment',
] as const;
export const recordActionSchema = z.enum(recordActions);
export type RecordAction = z.infer<typeof recordActionSchema>;

export const automationActions = [
  'automation|create',
  'automation|delete',
  'automation|read',
  'automation|update',
] as const;
export const automationActionSchema = z.enum(automationActions);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const userActions = ['user|email_read'] as const;
export const userActionSchema = z.enum(userActions);
export type UserAction = z.infer<typeof userActionSchema>;

export const tableRecordHistoryActions = ['table_record_history|read'] as const;
export const tableRecordHistoryActionSchema = z.enum(tableRecordHistoryActions);
export type TableRecordHistoryAction = z.infer<typeof tableRecordHistoryActionSchema>;

export const instanceActions = ['instance|read', 'instance|update'] as const;
export const instanceActionSchema = z.enum(instanceActions);
export type InstanceAction = z.infer<typeof instanceActionSchema>;

export type Action =
  | SpaceAction
  | BaseAction
  | TableAction
  | ViewAction
  | FieldAction
  | RecordAction
  | AutomationAction
  | UserAction
  | TableRecordHistoryAction
  | InstanceAction;

export type ActionPrefixMap = {
  [ActionPrefix.Space]: SpaceAction[];
  [ActionPrefix.Base]: BaseAction[];
  [ActionPrefix.Table]: TableAction[];
  [ActionPrefix.View]: ViewAction[];
  [ActionPrefix.Field]: FieldAction[];
  [ActionPrefix.Record]: RecordAction[];
  [ActionPrefix.Automation]: AutomationAction[];
  [ActionPrefix.User]: UserAction[];
  [ActionPrefix.TableRecordHistory]: TableRecordHistoryAction[];
  [ActionPrefix.Instance]: InstanceAction[];
};
export const actionPrefixMap: ActionPrefixMap = {
  [ActionPrefix.Space]: [...spaceActions],
  [ActionPrefix.Base]: [...baseActions],
  [ActionPrefix.Table]: [...tableActions],
  [ActionPrefix.View]: [...viewActions],
  [ActionPrefix.Field]: [...fieldActions],
  [ActionPrefix.Record]: [...recordActions],
  [ActionPrefix.Automation]: [...automationActions],
  [ActionPrefix.TableRecordHistory]: [...tableRecordHistoryActions],
  [ActionPrefix.User]: [...userActions],
  [ActionPrefix.Instance]: [...instanceActions],
};
