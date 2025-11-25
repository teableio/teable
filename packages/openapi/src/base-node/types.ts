import { z } from '../zod';

export enum BaseNodeResourceType {
  Table = 'table',
  Dashboard = 'dashboard',
  Workflow = 'workflow',
  App = 'app',
  Folder = 'folder',
}

export const baseNodeResourceTypeSchema = z.nativeEnum(BaseNodeResourceType);

export const baseNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  resourceId: z.string(),
  resourceType: baseNodeResourceTypeSchema,
  name: z.string(),
  icon: z.string().nullable().optional(),
  order: z.number(),
});

export const baseNodeVoSchema = baseNodeSchema.extend({
  parent: z
    .object({
      id: z.string(),
    })
    .nullable()
    .optional(),
  children: z
    .array(
      z.object({
        id: z.string(),
        order: z.number(),
      })
    )
    .nullable()
    .optional(),
});

export type IBaseNodeVo = z.infer<typeof baseNodeVoSchema>;

export type IBaseNodePresenceDeletePayload = {
  event: 'delete';
  data: Pick<IBaseNodeVo, 'id'>;
};

export type IBaseNodePresenceCreatePayload = {
  event: 'create';
  data: IBaseNodeVo;
};

export type IBaseNodePresenceUpdatePayload = {
  event: 'update';
  data: IBaseNodeVo;
};

export type IBaseNodePresenceFlushPayload = {
  event: 'flush';
};

export type IBaseNodePresencePayload =
  | IBaseNodePresenceCreatePayload
  | IBaseNodePresenceUpdatePayload
  | IBaseNodePresenceDeletePayload
  | IBaseNodePresenceFlushPayload;
