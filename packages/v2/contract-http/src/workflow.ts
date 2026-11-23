import { z } from 'zod';

import { apiOkResponseDtoSchema } from './shared/http';
import { oc } from './shared/orpc';
import {
  aggregateRecordsDataSchema,
  aggregateRecordsQuerySchema,
  countRecordsDataSchema,
  countRecordsQuerySchema,
  importedTableDtoSchema,
  importFileOptionsSchema,
  importSheetSummaryDtoSchema,
  importStatusDataSchema,
  inplaceImportFileOptionsSchema,
} from './workflowDto';

const baseId = z.string().startsWith('bse');
const tableId = z.string().startsWith('tbl');
const route = <TName extends string>(name: TName) => ({
  method: 'POST' as const,
  path: `/workflows/${name}` as const,
  successStatus: 200,
  tags: ['workflows'],
});

export const v2WorkflowInputSchemas = {
  aggregateRecords: aggregateRecordsQuerySchema.extend({ tableId }).strict(),
  countRecords: countRecordsQuerySchema.extend({ tableId }).strict(),
  importTableFromFile: z.object({ baseId, options: importFileOptionsSchema }).strict(),
  inplaceImportTableFromFile: z
    .object({ baseId, tableId, options: inplaceImportFileOptionsSchema })
    .strict(),
  getImportStatus: z.object({ tableId }).strict(),
};

export type V2WorkflowInputs = {
  [K in keyof typeof v2WorkflowInputSchemas]: z.output<(typeof v2WorkflowInputSchemas)[K]>;
};

export const v2WorkflowContract = {
  aggregateRecords: oc
    .route(route('aggregateRecords'))
    .input(v2WorkflowInputSchemas.aggregateRecords)
    .output(apiOkResponseDtoSchema(aggregateRecordsDataSchema)),
  countRecords: oc
    .route(route('countRecords'))
    .input(v2WorkflowInputSchemas.countRecords)
    .output(apiOkResponseDtoSchema(countRecordsDataSchema)),
  importTableFromFile: oc
    .route(route('importTableFromFile'))
    .input(v2WorkflowInputSchemas.importTableFromFile)
    .output(
      apiOkResponseDtoSchema(importedTableDtoSchema.array()).extend({
        sheets: importSheetSummaryDtoSchema.array(),
      })
    ),
  inplaceImportTableFromFile: oc
    .route(route('inplaceImportTableFromFile'))
    .input(v2WorkflowInputSchemas.inplaceImportTableFromFile)
    .output(apiOkResponseDtoSchema(z.object({ tableId, jobId: z.string() }))),
  getImportStatus: oc
    .route(route('getImportStatus'))
    .input(v2WorkflowInputSchemas.getImportStatus)
    .output(apiOkResponseDtoSchema(importStatusDataSchema)),
};
