import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { StatisticsFunc } from '../aggregation';

export const fieldsViewVisibleRoSchema = z.object({
  viewFields: z
    .object({
      fieldId: z.string().startsWith(IdPrefix.Field).length(19),
      hidden: z.boolean(),
    })
    .array()
    .nonempty(),
});

export type IColumnMeta = z.infer<typeof columnMetaSchema>;

export type IGridColumnMeta = z.infer<typeof gridColumnMetaSchema>;

export type IKanbanColumnMeta = z.infer<typeof kanbanColumnMetaSchema>;

export type IGalleryColumnMeta = z.infer<typeof galleryColumnMetaSchema>;

export type IFormColumnMeta = z.infer<typeof formColumnMetaSchema>;

export type IColumn = z.infer<typeof columnSchema>;

export type IGridColumn = z.infer<typeof gridColumnSchema>;

export type IKanbanColumn = z.infer<typeof kanbanColumnSchema>;

export type IFormColumn = z.infer<typeof formColumnSchema>;

export type IGalleryColumn = z.infer<typeof galleryColumnSchema>;

export const columnSchemaBase = z
  .object({
    order: z.number().openapi({
      description: 'Order is a floating number, column will sort by it in the view.',
    }),
  })
  .openapi({
    description: 'A mapping of field IDs to their corresponding column metadata.',
  });

export const gridColumnSchema = columnSchemaBase.merge(
  z.object({
    width: z.number().optional().openapi({
      description: 'Column width in the view.',
    }),
    hidden: z.boolean().optional().openapi({
      description: 'If column hidden in the view.',
    }),
    statisticFunc: z.nativeEnum(StatisticsFunc).nullable().optional().openapi({
      description: 'Statistic function of the column in the view.',
    }),
  })
);

export const kanbanColumnSchema = columnSchemaBase.merge(
  z.object({
    visible: z.boolean().optional().openapi({
      description: 'If column visible in the view.',
    }),
  })
);

export const formColumnSchema = columnSchemaBase.merge(
  z.object({
    visible: z.boolean().optional().openapi({
      description: 'If column visible in the view.',
    }),
    required: z.boolean().optional().openapi({
      description: 'If column is required.',
    }),
  })
);

export const galleryColumnSchema = columnSchemaBase.merge(
  z.object({
    width: z.number().optional().openapi({
      description: 'Column width in the view.',
    }),
  })
);

export const columnSchema = z.union([gridColumnSchema, kanbanColumnSchema, formColumnSchema]);

export const columnMetaSchema = z.record(z.string().startsWith(IdPrefix.Field), columnSchema);

export const gridColumnMetaSchema = z.record(
  z.string().startsWith(IdPrefix.Field),
  gridColumnSchema
);

export const kanbanColumnMetaSchema = z.record(
  z.string().startsWith(IdPrefix.Field),
  kanbanColumnSchema
);

export const formColumnMetaSchema = z.record(
  z.string().startsWith(IdPrefix.Field),
  formColumnSchema
);

export const galleryColumnMetaSchema = z.record(
  z.string().startsWith(IdPrefix.Field),
  galleryColumnSchema
);

export const columnMetaRoSchema = z
  .object({
    fieldId: z
      .string()
      .startsWith(IdPrefix.Field)
      .describe('Field ID')
      .openapi({ description: 'Field ID' }),
    columnMeta: z.union([
      gridColumnSchema.partial().strict(),
      kanbanColumnSchema.partial().strict(),
      formColumnSchema.partial().strict(),
    ]),
  })
  .array();

export type IColumnMetaRo = z.infer<typeof columnMetaRoSchema>;

export type IFieldsViewVisibleRo = z.infer<typeof fieldsViewVisibleRoSchema>;
