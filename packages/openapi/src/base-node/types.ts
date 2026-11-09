import { userInfoVoSchema } from '../auth/user';
import { ResourceType } from '../types';
import { z } from '../zod';

export enum BaseNodeResourceType {
  Table = ResourceType.Table,
  Dashboard = ResourceType.Dashboard,
  Workflow = ResourceType.Workflow,
  App = ResourceType.App,
  Folder = ResourceType.Folder,
  Routine = ResourceType.Routine,
}

const defaultResourceMetaSchema = z.object({
  name: z.string(),
  icon: z.string().nullable().optional(),
  createdByUser: userInfoVoSchema.nullable().optional(),
  createdTime: z.string().nullable().optional(),
  lastModifiedByUser: userInfoVoSchema.nullable().optional(),
  lastModifiedTime: z.string().nullable().optional(),
});

export const baseNodeFolderResourceMetaSchema = defaultResourceMetaSchema;

export type IBaseNodeFolderResourceMeta = z.infer<typeof baseNodeFolderResourceMetaSchema>;

export const baseNodeTableResourceMetaSchema = defaultResourceMetaSchema.extend({
  defaultViewId: z.string().nullable().optional(),
  loginAppId: z.string().optional(),
  loginApps: z
    .array(z.object({ id: z.string(), name: z.string(), emailFieldId: z.string().optional() }))
    .optional(),
});

export type IBaseNodeTableResourceMeta = z.infer<typeof baseNodeTableResourceMetaSchema>;

export const baseNodeAppResourceMetaSchema = defaultResourceMetaSchema.extend({
  publicUrl: z.string().nullable().optional(),
  publishedVersion: z.number().nullable().optional(),
});

export type IBaseNodeAppResourceMeta = z.infer<typeof baseNodeAppResourceMetaSchema>;

export const baseNodeDashboardResourceMetaSchema = defaultResourceMetaSchema;

export type IBaseNodeDashboardResourceMeta = z.infer<typeof baseNodeDashboardResourceMetaSchema>;

export const baseNodeWorkflowResourceMetaSchema = defaultResourceMetaSchema.extend({
  isActive: z.boolean().nullable().optional(),
});

export type IBaseNodeWorkflowResourceMeta = z.infer<typeof baseNodeWorkflowResourceMetaSchema>;

export const baseNodeRoutineResourceMetaSchema = defaultResourceMetaSchema.extend({
  status: z.string().nullable().optional(),
});

export type IBaseNodeRoutineResourceMeta = z.infer<typeof baseNodeRoutineResourceMetaSchema>;

const baseNodeResourceMetaSchema = z.union([
  baseNodeWorkflowResourceMetaSchema,
  baseNodeRoutineResourceMetaSchema,
  baseNodeTableResourceMetaSchema,
  baseNodeAppResourceMetaSchema,
  baseNodeDashboardResourceMetaSchema,
  baseNodeFolderResourceMetaSchema,
]);

export type IBaseNodeResourceMeta = z.infer<typeof baseNodeResourceMetaSchema>;

export type IBaseNodeResourceMetaWithId = IBaseNodeResourceMeta & { id: string };

const baseNodeBaseSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  resourceId: z.string(),
  order: z.number(),
  defaultUrl: z.string().optional(),
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

export const baseNodeVoSchema = z.discriminatedUnion('resourceType', [
  baseNodeBaseSchema.extend({
    resourceType: z.literal(BaseNodeResourceType.Table),
    resourceMeta: baseNodeTableResourceMetaSchema,
  }),
  baseNodeBaseSchema.extend({
    resourceType: z.literal(BaseNodeResourceType.Dashboard),
    resourceMeta: baseNodeDashboardResourceMetaSchema,
  }),
  baseNodeBaseSchema.extend({
    resourceType: z.literal(BaseNodeResourceType.Workflow),
    resourceMeta: baseNodeWorkflowResourceMetaSchema,
  }),
  baseNodeBaseSchema.extend({
    resourceType: z.literal(BaseNodeResourceType.App),
    resourceMeta: baseNodeAppResourceMetaSchema,
  }),
  baseNodeBaseSchema.extend({
    resourceType: z.literal(BaseNodeResourceType.Folder),
    resourceMeta: baseNodeFolderResourceMetaSchema,
  }),
  baseNodeBaseSchema.extend({
    resourceType: z.literal(BaseNodeResourceType.Routine),
    resourceMeta: baseNodeRoutineResourceMetaSchema,
  }),
]);

export type IBaseNodeVo = z.infer<typeof baseNodeVoSchema>;

export type IBaseNodePresenceDeletePayload = {
  event: 'delete';
  data: Pick<IBaseNodeVo, 'id'>;
};

/**
 * A change on the base's node channel carries the node's id and nothing else. Everyone in the base
 * hears it, and so does whoever holds any of its share links, so it must not say what the node is:
 * a listener refetches the tree, which hands each caller only the nodes they may see.
 */
export type IBaseNodePresenceCreatePayload = {
  event: 'create';
  data: Pick<IBaseNodeVo, 'id'>;
};

export type IBaseNodePresenceUpdatePayload = {
  event: 'update';
  data: Pick<IBaseNodeVo, 'id'>;
};

export type IBaseNodePresenceFlushPayload = {
  event: 'flush';
};

export type IBaseNodePresencePayload =
  | IBaseNodePresenceCreatePayload
  | IBaseNodePresenceUpdatePayload
  | IBaseNodePresenceDeletePayload
  | IBaseNodePresenceFlushPayload;
