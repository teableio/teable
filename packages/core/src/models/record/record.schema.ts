/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { filterSchema } from '../view';
import { CellFormat, FieldKeyType } from './record';

export const recordSchema = z.object({
  id: z.string().startsWith(IdPrefix.Record).openapi({
    description: 'The record id.',
  }),
  fields: z.record(z.unknown()).openapi({
    description: 'Objects with a fields key mapping fieldId or field name to value for that field.',
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

export const fieldKeyTypeRoSchema = z
  .nativeEnum(FieldKeyType, {
    errorMap: () => ({ message: 'Error fieldKeyType, You should set it to "name" or "id"' }),
  })
  .default(FieldKeyType.Name) // is not work with optional()...
  .transform((v) => v ?? FieldKeyType.Name)
  .optional()
  .openapi({ description: 'Define the key type of record.fields[key], default is "name"' });

export const getRecordQuerySchema = z.object({
  projection: z.record(z.boolean()).optional().openapi({
    description:
      'Objects with a fields key mapping field id or field name to value for that field.',
  }),
  cellFormat: z
    .nativeEnum(CellFormat, {
      errorMap: () => ({ message: 'Error cellFormate, You should set it to "json" or "text"' }),
    })
    .default(CellFormat.Json)
    .optional()
    .openapi({
      description: 'value formate, you can set it to text if you only need simple string value',
    }),
  fieldKeyType: fieldKeyTypeRoSchema,
});

export type IGetRecordQuery = z.infer<typeof getRecordQuerySchema>;

const defaultPageSize = 100;
const maxPageSize = 10000;

export const getRecordsQuerySchema = getRecordQuerySchema.extend({
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
  recordIds: z
    .array(z.string().startsWith(IdPrefix.Record, 'Error recordIds, recordId is illegal'))
    .optional()
    .openapi({
      example: ['recXXXXXXX'],
      description: 'Specify the records you want to fetch',
    }),
  viewId: z.string().startsWith(IdPrefix.View).optional().openapi({
    example: 'viwXXXXXXX',
    description:
      'Set the view you want to fetch, default is first view. result will filter and sort by view options.',
  }),
  filterByTql: z.string().optional().openapi({
    example: "{field} = 'Completed' AND {field} > 5",
    description:
      'A Teable Query Language (TQL) string used to filter results. It allows complex query conditions based on fields, operators, and values.',
  }),
  filter: filterSchema.optional().openapi({
    type: 'object',
  }),
});

export type IGetRecordsQuery = z.infer<typeof getRecordsQuerySchema>;

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
  total: z.number().openapi({
    description: 'Total number of records in this query.',
  }),
});

export type IRecordsVo = z.infer<typeof recordsVoSchema>;

export const createRecordsRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    records: z
      .object({
        fields: recordSchema.shape.fields,
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
    description: 'Create records',
  });

export type ICreateRecordsRo = z.infer<typeof createRecordsRoSchema>;

export const createRecordsVoSchema = recordsVoSchema.omit({
  total: true,
});

export type ICreateRecordsVo = z.infer<typeof createRecordsVoSchema>;

export const updateRecordRoSchema = z
  .object({
    fieldKeyType: fieldKeyTypeRoSchema,
    record: z.object({
      fields: recordSchema.shape.fields,
    }),
  })
  .openapi({
    description: 'Update record by record id',
  });

export type IUpdateRecordRo = z.infer<typeof updateRecordRoSchema>;

export const updateRecordByIndexRoSchema = updateRecordRoSchema
  .merge(
    z.object({
      index: z.number().min(0).openapi({
        description: 'The index of record in view, start from 0',
      }),
      viewId: z.string().startsWith(IdPrefix.View).openapi({
        description: 'The view id',
      }),
    })
  )
  .openapi({
    description: 'Update record by index in view',
  });

export type IUpdateRecordByIndexRo = z.infer<typeof updateRecordByIndexRoSchema>;
