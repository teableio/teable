/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';

export enum ActionPrefix {
  Space = 'space',
  Base = 'base',
  Table = 'table',
  View = 'view',
  Record = 'record',
  Field = 'field',
}

const defaultActionsSchema = z.enum(['create', 'update', 'delete', 'read']);

export const spaceActionsSchema = defaultActionsSchema.or(
  z.enum(['invite_email', 'invite_link', 'grant_role'])
);

export type SpaceActions = `${ActionPrefix.Space}|${z.infer<typeof spaceActionsSchema>}`;

export const baseActionsSchema = defaultActionsSchema.or(z.enum(['invite_email', 'invite_link']));

export type BaseActions = `${ActionPrefix.Base}|${z.infer<typeof baseActionsSchema>}`;

export const tableActionsSchema = defaultActionsSchema.or(z.enum(['import']));

export type TableActions = `${ActionPrefix.Table}|${z.infer<typeof tableActionsSchema>}`;

export const viewActionsSchema = defaultActionsSchema;

export type ViewActions = `${ActionPrefix.View}|${z.infer<typeof viewActionsSchema>}`;

export const fieldActionsSchema = defaultActionsSchema;

export type FieldActions = `${ActionPrefix.Field}|${z.infer<typeof fieldActionsSchema>}`;

export const recordActionsSchema = defaultActionsSchema.or(z.enum(['comment']));

export type RecordActions = `${ActionPrefix.Record}|${z.infer<typeof recordActionsSchema>}`;

export type AllActions =
  | SpaceActions
  | BaseActions
  | TableActions
  | ViewActions
  | FieldActions
  | RecordActions;

export type ActionPrefixMap = {
  [ActionPrefix.Space]: SpaceActions[];
  [ActionPrefix.Base]: BaseActions[];
  [ActionPrefix.Table]: TableActions[];
  [ActionPrefix.View]: ViewActions[];
  [ActionPrefix.Field]: FieldActions[];
  [ActionPrefix.Record]: RecordActions[];
};

export const actionPrefixMap: ActionPrefixMap = {
  [ActionPrefix.Space]: ['space|create', 'space|delete', 'space|read', 'space|update'],
  [ActionPrefix.Base]: ['base|create', 'base|delete', 'base|read', 'base|update'],
  [ActionPrefix.Table]: ['table|create', 'table|delete', 'table|read', 'table|update'],
  [ActionPrefix.View]: ['view|create', 'view|delete', 'view|read', 'view|update'],
  [ActionPrefix.Field]: ['field|create', 'field|delete', 'field|read', 'field|update'],
  [ActionPrefix.Record]: [
    'record|comment',
    'record|create',
    'record|delete',
    'record|read',
    'record|update',
  ],
};
