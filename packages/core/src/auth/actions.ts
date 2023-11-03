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
