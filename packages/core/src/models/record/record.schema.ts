import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { CellFormat, FieldKeyType } from './record';

export const recordSchema = z.object({
  id: z.string().startsWith(IdPrefix.Record).openapi({
    description: 'The record id.',
  }),
  fields: z.record(
    z.unknown().openapi({
      description:
        'Objects with a fields key mapping fieldId or field name to value for that field.',
    })
  ),
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
  recordOrder: z.record(z.number()),
});

export type IRecord = z.infer<typeof recordSchema>;

const defaultPageSize = 100;
const maxPageSize = 10000;

export const recordsRoSchema = z.object({
  take: z
    .number()
    .min(1, 'You should at least take 1 record')
    .max(maxPageSize, `Can't take more than ${maxPageSize} records, please reduce take count`)
    .default(defaultPageSize)
    .optional()
    .openapi({
      example: defaultPageSize,
      description: 'The record count you want to take',
    }),
  skip: z
    .number()
    .min(0, 'You can not skip a negative count of records')
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
      'Set the view you want to fetch, default is first view. result will influent by view options.',
  }),
  projection: z.array(z.string()).optional(),
  cellFormat: z
    .nativeEnum(CellFormat, {
      errorMap: () => ({ message: 'Error cellFormate, You should set it to "json" or "text"' }),
    })
    .default(CellFormat.Json)
    .optional()
    .openapi({
      description: 'value formate, you can set it to text if you only need simple string value',
    }),
  fieldKey: z
    .nativeEnum(FieldKeyType, {
      errorMap: () => ({ message: 'Error fieldKey, You should set it to "name" or "id"' }),
    })
    .default(FieldKeyType.Name)
    .optional()
    .openapi({ description: 'Set the key of record.fields[key], default is "name"' }),
});

export type IRecordsRo = z.infer<typeof recordsRoSchema>;

export const recordsVoSchema = z.object({
  records: z.array(recordSchema).openapi({
    example: [
      {
        id: 'recXXXXXXX',
        fields: {
          fldXXXXXXXXXXXXXXX: 'text value',
        },
        recordOrder: {},
      },
    ],
    description:
      'Array of objects with a fields key mapping fieldId or field name to value for that field.',
  }),
  total: z.number().openapi({
    description: 'Total number of records in this query.',
  }),
});

export type IRecordsVo = z.infer<typeof recordsVoSchema>;

export const recordVoSchema = z.object({
  record: recordSchema,
});

export type IRecordVo = z.infer<typeof recordVoSchema>;
