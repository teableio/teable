import { oc } from './shared/orpc';
import { recordFilterSchema, recordSearchInputSchema } from '@teable/v2-core';
import { z } from 'zod';

import { apiOkResponseDtoSchema } from './shared/http';
import { tableRecordDtoSchema } from './table/recordDto';

const identity = { shareId: z.string().startsWith('shr').min(4) };
const fields = z.record(z.string().startsWith('fld'), z.unknown());
const recordId = z.string().startsWith('rec');
const query = {
  ...identity,
  filter: recordFilterSchema.optional(),
  sort: z
    .array(z.object({ fieldId: z.string(), order: z.enum(['asc', 'desc']) }).strict())
    .optional(),
  search: recordSearchInputSchema,
  projection: z.array(z.string().startsWith('fld')).min(1).optional(),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().nonnegative().default(0),
};
const queryInput = z.object(query).strict();
const sharedRecord = tableRecordDtoSchema.pick({ id: true, fields: true });
const recordsData = z.object({ records: z.array(sharedRecord) });
const fieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  isPrimary: z.boolean().optional(),
  isComputed: z.boolean().optional(),
  isMultipleCellValue: z.boolean().optional(),
});
const getData = z.object({
  shareId: z.string(),
  view: z.object({ id: z.string(), name: z.string(), type: z.string() }),
  fields: z.array(fieldSchema),
  capabilities: z.object({
    read: z.boolean(),
    copy: z.boolean(),
    edit: z.boolean(),
    submit: z.boolean(),
    requireLogin: z.boolean(),
  }),
});
const route = (name: string) => ({
  method: 'POST' as const,
  path: `/share/${name}` as const,
  successStatus: 200,
  tags: ['share'],
});

/** Visitor-only API. No member resource IDs, diagnostics, actor or scope inputs are admitted. */
export const v2ShareContract = {
  authenticate: oc
    .route(route('authenticate'))
    .input(z.object({ ...identity, password: z.string().min(1) }).strict())
    .output(apiOkResponseDtoSchema(z.object({ token: z.string() }))),
  get: oc
    .route(route('get'))
    .input(z.object(identity).strict())
    .output(apiOkResponseDtoSchema(getData)),
  listRecords: oc
    .route(route('listRecords'))
    .input(queryInput)
    .output(apiOkResponseDtoSchema(recordsData)),
  getRecord: oc
    .route(route('getRecord'))
    .input(z.object({ ...identity, recordId }).strict())
    .output(apiOkResponseDtoSchema(sharedRecord)),
  countRecords: oc
    .route(route('countRecords'))
    .input(
      z
        .object({
          ...identity,
          filter: query.filter,
          search: query.search,
          projection: query.projection,
        })
        .strict()
    )
    .output(apiOkResponseDtoSchema(z.object({ count: z.number() }))),
  aggregateRecords: oc
    .route(route('aggregateRecords'))
    .input(
      z
        .object({
          ...identity,
          filter: query.filter,
          search: query.search,
          metrics: z
            .array(
              z
                .object({ fieldId: z.string().startsWith('fld'), statisticFunc: z.string() })
                .strict()
            )
            .min(1)
            .max(100),
        })
        .strict()
    )
    .output(
      apiOkResponseDtoSchema(
        z.object({
          aggregations: z.array(
            z.object({
              fieldId: z.string(),
              total: z.record(z.string(), z.unknown()),
            })
          ),
        })
      )
    ),
  copy: oc
    .route(route('copy'))
    .input(queryInput)
    .output(apiOkResponseDtoSchema(z.object({ content: z.string() }))),
  submitRecord: oc
    .route(route('submitRecord'))
    .input(z.object({ ...identity, fields, typecast: z.boolean().optional() }).strict())
    .output(apiOkResponseDtoSchema(z.object({ id: recordId }))),
  createRecords: oc
    .route(route('createRecords'))
    .input(
      z
        .object({
          ...identity,
          records: z.array(z.object({ fields }).strict()).min(1).max(1000),
          typecast: z.boolean().optional(),
        })
        .strict()
    )
    .output(apiOkResponseDtoSchema(z.object({ recordIds: z.array(recordId) }))),
  updateRecord: oc
    .route(route('updateRecord'))
    .input(z.object({ ...identity, recordId, fields, typecast: z.boolean().optional() }).strict())
    .output(apiOkResponseDtoSchema(z.object({ id: recordId }))),
  deleteRecords: oc
    .route(route('deleteRecords'))
    .input(z.object({ ...identity, recordIds: z.array(recordId).min(1).max(1000) }).strict())
    .output(apiOkResponseDtoSchema(z.object({ deletedRecordIds: z.array(recordId) }))),
};

export const shareQueryInputSchema = queryInput;
export type IShareQueryInput = z.output<typeof queryInput>;
