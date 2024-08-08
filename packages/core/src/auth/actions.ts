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
  RecordHistory = 'record_history',
}

const defaultActionsSchema = z.enum(['create', 'update', 'delete', 'read']);

export const spaceActionsSchema = defaultActionsSchema.or(
  z.enum(['invite_email', 'invite_link', 'grant_role'])
);

export type SpaceActions = `${ActionPrefix.Space}|${z.infer<typeof spaceActionsSchema>}`;

export const baseActionsSchema = defaultActionsSchema.or(
  z.enum([
    'invite_email',
    'invite_link',
    'table_import',
    'table_export',
    'authority_matrix_config',
    'db_connection',
  ])
);

export type BaseActions = `${ActionPrefix.Base}|${z.infer<typeof baseActionsSchema>}`;

export const tableActionsSchema = defaultActionsSchema.or(z.enum(['import', 'export']));

export type TableActions = `${ActionPrefix.Table}|${z.infer<typeof tableActionsSchema>}`;

export const viewActionsSchema = defaultActionsSchema;

export type ViewActions = `${ActionPrefix.View}|${z.infer<typeof viewActionsSchema>}`;

export const fieldActionsSchema = defaultActionsSchema;

export type FieldActions = `${ActionPrefix.Field}|${z.infer<typeof fieldActionsSchema>}`;

export const recordActionsSchema = defaultActionsSchema.or(z.enum(['comment']));

export type RecordActions = `${ActionPrefix.Record}|${z.infer<typeof recordActionsSchema>}`;

export const automationActionsSchema = defaultActionsSchema;

export type AutomationActions =
  `${ActionPrefix.Automation}|${z.infer<typeof automationActionsSchema>}`;

export const userActionsSchema = z.enum(['email_read']);

export type UserActions = `${ActionPrefix.User}|${z.infer<typeof userActionsSchema>}`;

export const recordHistoryActionsSchema = z.enum(['read']);

export type RecordHistoryActions =
  `${ActionPrefix.RecordHistory}|${z.infer<typeof recordHistoryActionsSchema>}`;

export type AllActions =
  | SpaceActions
  | BaseActions
  | TableActions
  | ViewActions
  | FieldActions
  | RecordActions
  | AutomationActions
  | UserActions
  | RecordHistoryActions;

export type ActionPrefixMap = {
  [ActionPrefix.Space]: SpaceActions[];
  [ActionPrefix.Base]: BaseActions[];
  [ActionPrefix.Table]: TableActions[];
  [ActionPrefix.View]: ViewActions[];
  [ActionPrefix.Field]: FieldActions[];
  [ActionPrefix.Record]: RecordActions[];
  [ActionPrefix.Automation]: AutomationActions[];
  [ActionPrefix.User]: UserActions[];
  [ActionPrefix.RecordHistory]: RecordHistoryActions[];
};

export const actionPrefixMap: ActionPrefixMap = {
  [ActionPrefix.Space]: ['space|create', 'space|delete', 'space|read', 'space|update'],
  [ActionPrefix.Base]: [
    'base|create',
    'base|delete',
    'base|read',
    'base|update',
    'base|table_import',
    'base|table_export',
    'base|db_connection',
    'base|authority_matrix_config',
  ],
  [ActionPrefix.Table]: [
    'table|create',
    'table|delete',
    'table|read',
    'table|update',
    'table|import',
    'table|export',
  ],
  [ActionPrefix.View]: ['view|create', 'view|delete', 'view|read', 'view|update'],
  [ActionPrefix.Field]: ['field|create', 'field|delete', 'field|read', 'field|update'],
  [ActionPrefix.Record]: [
    'record|create',
    'record|delete',
    'record|read',
    'record|update',
    'record|comment',
  ],
  [ActionPrefix.Automation]: [
    'automation|create',
    'automation|delete',
    'automation|read',
    'automation|update',
  ],
  [ActionPrefix.RecordHistory]: ['record_history|read'],
  [ActionPrefix.User]: ['user|email_read'],
};
