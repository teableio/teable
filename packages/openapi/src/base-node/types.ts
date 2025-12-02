import { z } from '../zod';

export enum BaseNodeResourceType {
  Table = 'table',
  Dashboard = 'dashboard',
  Workflow = 'workflow',
  App = 'app',
  Folder = 'folder',
}

export const baseNodeResourceTypeSchema = z.nativeEnum(BaseNodeResourceType);

const defaultResourceMetaSchema = z.object({
  name: z.string(),
  icon: z.string().nullable().optional(),
});

export const folderResourceMetaSchema = defaultResourceMetaSchema;

export type IFolderResourceMeta = z.infer<typeof folderResourceMetaSchema>;

export const tableResourceMetaSchema = defaultResourceMetaSchema.extend({
  defaultViewId: z.string().nullable().optional(),
});

export type ITableResourceMeta = z.infer<typeof tableResourceMetaSchema>;

export const appResourceMetaSchema = defaultResourceMetaSchema;

export type IAppResourceMeta = z.infer<typeof appResourceMetaSchema>;

export const dashboardResourceMetaSchema = defaultResourceMetaSchema;

export type IDashboardResourceMeta = z.infer<typeof dashboardResourceMetaSchema>;

export const workFlowResourceMetaSchema = defaultResourceMetaSchema.extend({
  isActive: z.boolean().nullable().optional(),
});

export type IWorkflowResourceMeta = z.infer<typeof workFlowResourceMetaSchema>;

const baseNodeResourceMetaSchema = z.union([
  workFlowResourceMetaSchema,
  tableResourceMetaSchema,
  appResourceMetaSchema,
  dashboardResourceMetaSchema,
  folderResourceMetaSchema,
]);

export type IBaseNodeResourceMeta = z.infer<typeof baseNodeResourceMetaSchema>;

export type IBaseNodeResourceMetaWithId = IBaseNodeResourceMeta & { id: string };

export const baseNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  resourceId: z.string(),
  resourceType: baseNodeResourceTypeSchema,
  order: z.number(),
  resourceMeta: baseNodeResourceMetaSchema.optional(),
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
