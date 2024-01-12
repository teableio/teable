/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { TQL_README } from '../../query/README';
import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { FILTER_DESCRIPTION, filterSchema, sortItemSchema, groupSchema } from '../view';
import { CellFormat, FieldKeyType } from './record';

export const recordSchema = z.object({
  id: z.string().startsWith(IdPrefix.Record).openapi({
    description: 'The record id.',
  }),
  name: z.string().optional().openapi({ description: 'primary field value' }),
  fields: z.record(z.unknown()).openapi({
    description: 'Objects with a fields key mapping fieldId or field name to value for that field.',
  }),
  autoNumber: z.number().optional().openapi({
    description: 'Auto number, a unique identifier for each record',
  }),
  createdTime: z.string().optional().openapi({
    description: 'Created time, date ISO string (new Date().toISOString).',
  }),
  lastModifiedTime: z.string().optional().openapi({
    description: 'Last modified time, date ISO string (new Date().toISOString).',
  }),
  createdBy: z.string().optional().openapi({
    description: 'Created by, user name',
  }),
  lastModifiedBy: z.string().optional().openapi({
    description: 'Last modified by, user name',
  }),
  recordOrder: z.record(z.number()).openapi({
    description:
      'The object key is view id, and record is sorted by this order in each view by default',
  }),
});

export type IRecord = z.infer<typeof recordSchema>;

export type ITinyRecord = Omit<IRecord, 'recordOrder'>;

export const fieldKeyTypeRoSchema = z
  .nativeEnum(FieldKeyType, {
    errorMap: () => ({ message: 'Error fieldKeyType, You should set it to "name" or "id"' }),
  })
  .default(FieldKeyType.Name) // is not work with optional()...
  .transform((v) => v ?? FieldKeyType.Name)
  .optional()
  .openapi({ description: 'Define the key type of record.fields[key], default is "name"' });

export const typecastSchema = z.boolean().optional().openapi({
  description:
    'Automatic data conversion from cellValues if the typecast parameter is passed in. Automatic conversion is disabled by default to ensure data integrity, but it may be helpful for integrating with 3rd party data sources.',
});

export const getRecordQuerySchema = z.object({
  projection: z.record(z.boolean()).optional().openapi({
    description:
      'Objects with a fields key mapping field id or field name to value for that field.',
  }),
  cellFormat: z
    .nativeEnum(CellFormat, {
      errorMap: () => ({ message: 'Error cellFormat, You should set it to "json" or "text"' }),
    })
    .default(CellFormat.Json)
    .optional()
    .openapi({
      description:
        'Define the return value  formate, you can set it to text if you only need simple string value',
    }),
  fieldKeyType: fieldKeyTypeRoSchema,
});

export type IGetRecordQuery = z.infer<typeof getRecordQuerySchema>;

const defaultPageSize = 100;
const maxPageSize = 10000;

export const queryBaseSchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View).optional().openapi({
    example: 'viwXXXXXXX',
    description:
      'Set the view you want to fetch, default is first view. result will filter and sort by view options.',
  }),
  filterByTql: z.string().optional().openapi({
    example: "{field} = 'Completed' AND {field} > 5",
    description: TQL_README,
  }),
  filter: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null) {
        return value;
      }

      const parsingResult = filterSchema.safeParse(JSON.parse(value));
      if (!parsingResult.success) {
        parsingResult.error.issues.forEach((issue) => {
          ctx.addIssue(issue);
        });
        return z.NEVER;
      }
      return parsingResult.data;
    })
    .openapi({
      type: 'string',
      description: FILTER_DESCRIPTION,
    }),
  filterLinkCellCandidate: z
    .tuple([z.string().startsWith(IdPrefix.Field), z.string().startsWith(IdPrefix.Record)])
    .or(z.string().startsWith(IdPrefix.Field))
    .optional()
    .openapi({
      example: ['fldXXXXXXX', 'recXXXXXXX'],
      description:
        'Filter out the records that can be selected by a given link cell from the relational table. For example, if the specified field is one to many or one to one relationship, recordId for which the field has already been selected will not appear.',
    }),
  filterLinkCellSelected: z
    .tuple([z.string().startsWith(IdPrefix.Field), z.string().startsWith(IdPrefix.Record)])
    .or(z.string().startsWith(IdPrefix.Field))
    .optional()
    .openapi({
      example: ['fldXXXXXXX', 'recXXXXXXX'],
      description:
        'Filter out selected records based on this link cell from the relational table. Note that viewId, filter, and orderBy will not take effect in this case because selected records has it own order.',
    }),
});

export type IQueryBaseRo = z.infer<typeof queryBaseSchema>;

const orderByDescription =
  'An array of sort objects that specifies how the records should be ordered.';

export const orderBySchema = sortItemSchema.array().openapi({
  type: 'array',
  description: orderByDescription,
});

// with orderBy for content related fetch
export const contentQueryBaseSchema = queryBaseSchema.extend({
  orderBy: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null) {
        return value;
      }

      const parsingResult = orderBySchema.safeParse(JSON.parse(value));
      if (!parsingResult.success) {
        parsingResult.error.issues.forEach((issue) => {
          ctx.addIssue(issue);
        });
        return z.NEVER;
      }
      return parsingResult.data;
    })
    .openapi({
      type: 'string',
      description: orderByDescription,
    }),
  groupBy: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value == null) {
        return value;
      }

      const parsingResult = groupSchema.safeParse(JSON.parse(value));
      if (!parsingResult.success) {
        parsingResult.error.issues.forEach((issue) => {
          ctx.addIssue(issue);
        });
        return z.NEVER;
      }
      return parsingResult.data;
    })
    .openapi({
      type: 'string',
      description: 'An array of group objects that specifies how the records should be grouped.',
    }),
});

export const getRecordsRoSchema = getRecordQuerySchema.merge(contentQueryBaseSchema).extend({
  take: z
    .string()
    .or(z.number())
    .transform(Number)
    .pipe(
      z
        .number()
        .min(1, 'You should at least take 1 record')
        .max(maxPageSize, `Can't take more than ${maxPageSize} records, please reduce take count`)
    )
    .default(defaultPageSize)
    .optional()
    .openapi({
      example: defaultPageSize,
      description: 'The record count you want to take',
    }),
  skip: z
    .string()
    .or(z.number())
    .transform(Number)
    .pipe(z.number().min(0, 'You can not skip a negative count of records'))
    .default(0)
    .optional()
    .openapi({
      example: 0,
      description: 'The records count you want to skip',
    }),
});

export type IGetRecordsRo = z.infer<typeof getRecordsRoSchema>;

export const recordsSchema = recordSchema.array().openapi({
  example: [
    {
      id: 'recXXXXXXX',
      fields: {
        'single line text': 'text value',
      },
      recordOrder: {},
    },
  ],
  description: 'Array of record objects ',
});

export const recordsVoSchema = z.object({
  records: recordSchema.array().openapi({
    example: [
      {
        id: 'recXXXXXXX',
        fields: {
          'single line text': 'text value',
        },
        recordOrder: {},
      },
    ],
    description: 'Array of record objects ',
  }),
  offset: z.string().optional().openapi({
    description:
      'If more records exist, the response includes an offset. Use this offset for fetching the next page of records.',
  }),
});

export type IRecordsVo = z.infer<typeof recordsVoSchema>;

export const createRecordsRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    typecast: typecastSchema,
    records: z
      .object({
        fields: recordSchema.shape.fields,
        recordOrder: z.record(z.number()).optional(),
      })
      .array()
      .openapi({
        example: [
          {
            fields: {
              'single line text': 'text value',
            },
          },
        ],
        description: 'Array of record objects ',
      }),
  })
  .openapi({
    description: 'Multiple Create records',
  });

export type ICreateRecordsRo = z.infer<typeof createRecordsRoSchema>;

export const createRecordsVoSchema = recordsVoSchema.omit({
  offset: true,
});

export type ICreateRecordsVo = z.infer<typeof createRecordsVoSchema>;

export const updateRecordRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    typecast: typecastSchema,
    record: z.object({
      fields: recordSchema.shape.fields,
    }),
  })
  .openapi({
    description: 'Update record by id',
  });

export type IUpdateRecordRo = z.infer<typeof updateRecordRoSchema>;

export const updateRecordsRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    typecast: typecastSchema,
    records: z.array(
      z.object({
        id: z.string(),
        fields: recordSchema.shape.fields,
      })
    ),
  })
  .openapi({
    description: 'Multiple Update records',
  });

export type IUpdateRecordsRo = z.infer<typeof updateRecordsRoSchema>;
