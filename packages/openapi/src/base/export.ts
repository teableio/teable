import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { fieldVoSchema, IdPrefix, viewVoSchema } from '@teable/core';
import { axios } from '../axios';
import { BaseNodeResourceType } from '../base-node/types';
import { pluginInstallStorageSchema } from '../dashboard';
import { PluginPosition } from '../plugin';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
export const EXPORT_BASE = '/base/{baseId}/export';

export const viewJsonSchema = viewVoSchema
  .pick({
    id: true,
    name: true,
    description: true,
    type: true,
    sort: true,
    filter: true,
    group: true,
    options: true,
    order: true,
    columnMeta: true,
    shareMeta: true,
    enableShare: true,
    shareId: true,
    isLocked: true,
  })
  .extend({
    tableId: z.string().startsWith(IdPrefix.Table).meta({
      description: 'The id of the table.',
    }),
  });

export const fieldJsonSchema = fieldVoSchema
  .pick({
    id: true,
    name: true,
    description: true,
    type: true,
    options: true,
    dbFieldName: true,
    notNull: true,
    unique: true,
    isPrimary: true,
    hasError: true,
    isLookup: true,
    meta: true,
    isConditionalLookup: true,
    lookupOptions: true,
    dbFieldType: true,
    aiConfig: true,
    cellValueType: true,
    isMultipleCellValue: true,
  })
  .extend({
    createdTime: z.string().datetime().meta({
      description: 'The create time of the field.',
    }),
    order: z.number().meta({
      description: 'The order of the field.',
    }),
  });

export const tableJsonSchema = z.object({
  id: z.string().startsWith(IdPrefix.Table).meta({
    description: 'The id of table.',
  }),
  name: z.string().meta({
    description: 'The name of the table.',
  }),
  description: z.string().optional().meta({
    description: 'The description of the table.',
  }),
  icon: z.string().emoji().optional().meta({
    description: 'The emoji icon string of the table.',
  }),
  order: z.number(),
  fields: fieldJsonSchema.array(),
  views: viewJsonSchema.array(),
  dbTableName: z.string().meta({
    description: 'The table name in the physical postgres database.',
  }),
});

export const pluginInstallJsonSchema = z.object({
  id: z.string().startsWith(IdPrefix.PluginInstall).meta({
    description: 'The id of the plugin install.',
  }),
  pluginId: z.string().startsWith(IdPrefix.Plugin).meta({
    description: 'The id of the plugin.',
  }),
  position: z.enum(PluginPosition).meta({
    description: 'The position of the plugin.',
  }),
  name: z.string().meta({
    description: 'The name of the plugin.',
  }),
  storage: pluginInstallStorageSchema,
});

export const dashboardJsonSchema = z.object({
  id: z.string().startsWith(IdPrefix.Dashboard).meta({
    description: 'The id of dashboard.',
  }),
  name: z.string().meta({
    description: 'The name of the dashboard.',
  }),
  layout: z.string().nullable(),
  pluginInstall: pluginInstallJsonSchema
    .extend({
      positionId: z.string().startsWith(IdPrefix.Dashboard).meta({
        description: 'The id of the dashboard.',
      }),
    })
    .array(),
});

export const pluginPanelJsonSchema = z.object({
  id: z.string().startsWith(IdPrefix.PluginPanel).meta({
    description: 'The id of the plugin panel.',
  }),
  name: z.string().meta({
    description: 'The name of the plugin panel.',
  }),
  tableId: z.string().startsWith(IdPrefix.Table).meta({
    description: 'The table id of the plugin panel.',
  }),
  layout: z.string().nullable(),
  pluginInstall: pluginInstallJsonSchema
    .extend({
      positionId: z.string().startsWith(IdPrefix.PluginPanel).meta({
        description: 'The id of the panel positionId.',
      }),
    })
    .array(),
});

export const viewPluginJsonSchema = viewJsonSchema.extend({
  pluginId: z.string().startsWith(IdPrefix.Plugin).meta({
    description: 'The id of the plugin.',
  }),
  pluginInstall: pluginInstallJsonSchema.extend({
    positionId: z.string().startsWith(IdPrefix.View).meta({
      description: 'The id of the view positionId.',
    }),
  }),
});

export const folderJsonSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const nodeJsonSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  resourceId: z.string(),
  resourceType: z.enum(BaseNodeResourceType),
  order: z.number(),
});

export const pluginJsonSchema = z.object({
  [PluginPosition.Dashboard]: dashboardJsonSchema.array(),
  [PluginPosition.Panel]: pluginPanelJsonSchema.array(),
  [PluginPosition.View]: viewPluginJsonSchema.array(),
});

export const BaseJsonSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  tables: tableJsonSchema.array(),
  folders: folderJsonSchema.array(),
  nodes: nodeJsonSchema.array(),
  plugins: pluginJsonSchema,
  version: z.string(),
});

export type IBaseJson = z.infer<typeof BaseJsonSchema>;

export type IFieldJson = IBaseJson['tables'][number]['fields'][number];

export type IFieldWithTableIdJson = IFieldJson & {
  targetTableId: string;
  sourceTableId: string;
};

export const ExportBaseRoute: RouteConfig = registerRoute({
  method: 'get',
  path: EXPORT_BASE,
  description: 'export a base by baseId',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: z.object({
      includeData: z.boolean().optional().default(true),
    }),
  },
  responses: {
    200: {
      description: 'export successfully',
    },
  },
  tags: ['base'],
});

export const exportBase = async (baseId: string, options?: { includeData?: boolean }) => {
  const includeData = options?.includeData ?? true;
  return await axios.get<null>(
    urlBuilder(EXPORT_BASE, {
      baseId,
    }),
    {
      params: {
        includeData,
      },
    }
  );
};
