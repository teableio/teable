/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';

enum IdPrefix {
  Space = 'space',
  Base = 'base',
  Table = 'table',
  View = 'view',
  Record = 'record',
  Field = 'field',
}

export { IdPrefix as PermissionIdPrefix };

const defaultActionsSchema = z.enum(['create', 'update', 'delete', 'read']);

export const spaceActionsSchema = defaultActionsSchema;

export type SpaceActions = `${IdPrefix.Space}|${z.infer<typeof spaceActionsSchema>}`;

export const baseActionsSchema = defaultActionsSchema;

export type BaseActions = `${IdPrefix.Base}|${z.infer<typeof baseActionsSchema>}`;

export const tableActionsSchema = defaultActionsSchema;

export type TableActions = `${IdPrefix.Table}|${z.infer<typeof tableActionsSchema>}`;

export const viewActionsSchema = defaultActionsSchema;

export type ViewActions = `${IdPrefix.View}|${z.infer<typeof viewActionsSchema>}`;

export const fieldActionsSchema = defaultActionsSchema;

export type FieldActions = `${IdPrefix.Field}|${z.infer<typeof fieldActionsSchema>}`;

export const recordActionsSchema = defaultActionsSchema.or(z.enum(['comment']));

export type RecordActions = `${IdPrefix.Record}|${z.infer<typeof recordActionsSchema>}`;
