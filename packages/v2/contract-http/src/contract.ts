import type { AnyContractRouter } from '@orpc/contract';
import {
  applyViewManualSortInputSchema,
  clearCommandInputSchema,
  createFieldInputSchema,
  createRecordInputSchema,
  createRecordsInputSchema,
  createTableInputSchema,
  createTablesInputSchema,
  createViewInputSchema,
  deleteByRangeCommandInputSchema,
  deleteFieldInputSchema,
  deleteRecordsInputSchema,
  deleteTableInputSchema,
  deleteViewInputSchema,
  disableViewShareInputSchema,
  duplicateBaseByIdInputSchema,
  duplicateFieldInputSchema,
  duplicateRecordInputSchema,
  duplicateTableInputSchema,
  duplicateViewInputSchema,
  enableViewShareInputSchema,
  getComputeActivityInputSchema,
  getRecordByIdInputSchema,
  getTableByIdInputSchema,
  getViewFilterLinkRecordsInputSchema,
  getViewInputSchema,
  getViewPluginInstallInputSchema,
  getViewSnapshotsInputSchema,
  importCsvInputSchema,
  importRecordsInputSchema,
  listTableRecordsInputSchema,
  listTablesInputSchema,
  listViewsInputSchema,
  pasteCommandInputSchema,
  refreshViewShareIdInputSchema,
  renameTableInputSchema,
  renameViewInputSchema,
  reorderRecordsInputSchema,
  restoreTableInputSchema,
  submitRecordInputSchema,
  updateFieldInputSchema,
  updateRecordInputSchema,
  updateRecordsInputSchema,
  updateTablePropertiesInputSchema,
  updateViewColumnMetaInputSchema,
  updateViewDescriptionInputSchema,
  updateViewFilterInputSchema,
  updateViewGroupInputSchema,
  updateViewLockedInputSchema,
  updateViewOptionsInputSchema,
  updateViewOrderInputSchema,
  updateViewPluginStorageInputSchema,
  updateViewShareMetaInputSchema,
  updateViewSortInputSchema,
  viewSnapshotSchema,
} from '@teable/v2-core';
import { z } from 'zod';
import { createBaseInputSchema, createBaseOkResponseSchema } from './base/createBase';
import { baseListItemDtoSchema } from './base/dto';
import { duplicateBaseOkResponseSchema } from './base/duplicateBase';
import {
  COMPLEXITY_ASSESS_MATRIX_PATH,
  COMPLEXITY_ASSESS_PATH,
  complexityAssessInputSchema,
  complexityAssessMatrixInputSchema,
  complexityAssessMatrixOkResponseSchema,
  complexityAssessOkResponseSchema,
} from './complexity';
import {
  OPERATION_PREVIEW_CAPABILITIES_PATH,
  OPERATION_PREVIEW_PATH,
  operationPreviewCapabilitiesInputSchema,
  operationPreviewCapabilitiesOkResponseSchema,
  operationPreviewInputSchema,
  operationPreviewOkResponseSchema,
} from './operationPreview';
import { v2ShareContract } from './share';
import { oc } from './shared/orpc';
import { booleanQuerySchema, jsonQuerySchema } from './shared/query';
import { clearOkResponseSchema } from './table/clear';
import { createFieldOkResponseSchema } from './table/createField';
import { createRecordOkResponseSchema } from './table/createRecord';
import { createRecordsOkResponseSchema } from './table/createRecords';
import { createTableErrorResponseSchema, createTableOkResponseSchema } from './table/createTable';
import { createTablesOkResponseSchema } from './table/createTables';
import { createViewOkResponseSchema } from './table/createView';
import { deleteByRangeOkResponseSchema } from './table/deleteByRange';
import { deleteFieldOkResponseSchema } from './table/deleteField';
import { deleteRecordsOkResponseSchema } from './table/deleteRecords';
import { deleteTableErrorResponseSchema, deleteTableOkResponseSchema } from './table/deleteTable';
import { duplicateFieldOkResponseSchema } from './table/duplicateField';
import { duplicateRecordOkResponseSchema } from './table/duplicateRecord';
import { duplicateTableOkResponseSchema } from './table/duplicateTable';
import {
  explainCreateFieldInputSchema,
  explainCreateRecordInputSchema,
  explainDeleteFieldInputSchema,
  explainDeleteRecordsInputSchema,
  explainDeleteTableInputSchema,
  explainOkResponseSchema,
  explainUpdateFieldInputSchema,
  explainUpdateRecordInputSchema,
} from './table/explainCommand';
import { getComputeActivityOkResponseSchema } from './table/getComputeActivity';
import { getRecordByIdOkResponseSchema } from './table/getRecordById';
import { getSchemaInputSchema } from './table/getSchema';
import { getTableByIdOkResponseSchema } from './table/getTableById';
import { getViewOkResponseSchema } from './table/getView';
import { importCsvOkResponseSchema } from './table/importCsv';
import { importRecordsOkResponseSchema } from './table/importRecords';
import { listFieldsOkResponseSchema, listFieldsRequestSchema } from './table/listFields';
import { listTableRecordsOkResponseSchema } from './table/listTableRecords';
import { listTablesOkResponseSchema } from './table/listTables';
import { listViewsOkResponseSchema } from './table/listViews';
import { pasteOkResponseSchema } from './table/paste';
import { renameTableOkResponseSchema } from './table/renameTable';
import { reorderRecordsOkResponseSchema } from './table/reorderRecords';
import { restoreTableOkResponseSchema } from './table/restoreTable';
import { submitRecordOkResponseSchema } from './table/submitRecord';
import { updateFieldOkResponseSchema } from './table/updateField';
import { updateRecordOkResponseSchema } from './table/updateRecord';
import { updateRecordsOkResponseSchema } from './table/updateRecords';
import { updateTablePropertiesOkResponseSchema } from './table/updateTableProperties';
import { upsertRecordsInputSchema, upsertRecordsOkResponseSchema } from './table/upsertRecords';
import {
  applyViewManualSortOkResponseSchema,
  applyViewSnapshotOkResponseSchema,
  getViewFilterLinkRecordsOkResponseSchema,
  getViewPluginInstallOkResponseSchema,
  getViewSnapshotsOkResponseSchema,
  installViewPluginInputSchema,
  installViewPluginOkResponseSchema,
  listViewDocIdsOkResponseSchema,
  updateViewPluginStorageOkResponseSchema,
  viewMutationOkResponseSchema,
  viewShareMutationOkResponseSchema,
  viewShareStateOkResponseSchema,
} from './table/viewOperations';
import { v2WorkflowContract } from './workflow';

const BASES_CREATE_PATH = '/bases/create';
const BASES_DUPLICATE_PATH = '/bases/duplicate';
const BASES_LIST_PATH = '/bases/list';
const TABLES_CREATE_FIELD_PATH = '/tables/createField';
const TABLES_CREATE_PATH = '/tables/create';
const TABLES_CREATE_TABLES_PATH = '/tables/createTables';
const TABLES_CREATE_VIEW_PATH = '/tables/createView';
const TABLES_CREATE_RECORD_PATH = '/tables/createRecord';
const TABLES_SUBMIT_RECORD_PATH = '/tables/submitRecord';
const TABLES_CREATE_RECORDS_PATH = '/tables/createRecords';
const TABLES_DELETE_RECORDS_PATH = '/tables/deleteRecords';
const TABLES_DELETE_FIELD_PATH = '/tables/deleteField';
const TABLES_DELETE_PATH = '/tables/delete';
const TABLES_EXPLAIN_CREATE_FIELD_PATH = '/tables/explainCreateField';
const TABLES_EXPLAIN_CREATE_RECORD_PATH = '/tables/explainCreateRecord';
const TABLES_EXPLAIN_UPDATE_FIELD_PATH = '/tables/explainUpdateField';
const TABLES_EXPLAIN_UPDATE_RECORD_PATH = '/tables/explainUpdateRecord';
const TABLES_EXPLAIN_DELETE_FIELD_PATH = '/tables/explainDeleteField';
const TABLES_EXPLAIN_DELETE_TABLE_PATH = '/tables/explainDeleteTable';
const TABLES_EXPLAIN_DELETE_RECORDS_PATH = '/tables/explainDeleteRecords';
const TABLES_GET_PATH = '/tables/get';
const TABLES_GET_COMPUTE_ACTIVITY_PATH = '/tables/getComputeActivity';
const TABLES_GET_RECORD_PATH = '/tables/getRecord';
const TABLES_GET_VIEW_PATH = '/tables/getView';
const TABLES_IMPORT_CSV_PATH = '/tables/importCsv';
const TABLES_IMPORT_RECORDS_PATH = '/tables/importRecords';
const TABLES_LIST_RECORDS_PATH = '/tables/listRecords';
const TABLES_LIST_PATH = '/tables/list';
const TABLES_LIST_VIEWS_PATH = '/tables/listViews';
const TABLES_PASTE_PATH = '/tables/paste';
const TABLES_CLEAR_PATH = '/tables/clear';
const TABLES_DELETE_BY_RANGE_PATH = '/tables/deleteByRange';
const TABLES_RENAME_PATH = '/tables/rename';
const TABLES_UPDATE_PROPERTIES_PATH = '/tables/updateProperties';
const TABLES_RESTORE_PATH = '/tables/restore';
const TABLES_UPDATE_FIELD_PATH = '/tables/updateField';
const TABLES_UPDATE_RECORD_PATH = '/tables/updateRecord';
const TABLES_UPDATE_RECORDS_PATH = '/tables/updateRecords';
const TABLES_REORDER_RECORDS_PATH = '/tables/reorderRecords';
const TABLES_DUPLICATE_FIELD_PATH = '/tables/duplicateField';
const TABLES_DUPLICATE_RECORD_PATH = '/tables/duplicateRecord';
const TABLES_DUPLICATE_TABLE_PATH = '/tables/duplicateTable';
const TABLES_DELETE_VIEW_PATH = '/tables/deleteView';
const TABLES_DUPLICATE_VIEW_PATH = '/tables/duplicateView';
const TABLES_RENAME_VIEW_PATH = '/tables/renameView';
const TABLES_UPDATE_VIEW_DESCRIPTION_PATH = '/tables/updateViewDescription';
const TABLES_UPDATE_VIEW_LOCKED_PATH = '/tables/updateViewLocked';
const TABLES_UPDATE_VIEW_ORDER_PATH = '/tables/updateViewOrder';
const TABLES_UPDATE_VIEW_COLUMN_META_PATH = '/tables/updateViewColumnMeta';
const TABLES_UPDATE_VIEW_FILTER_PATH = '/tables/updateViewFilter';
const TABLES_UPDATE_VIEW_SORT_PATH = '/tables/updateViewSort';
const TABLES_UPDATE_VIEW_GROUP_PATH = '/tables/updateViewGroup';
const TABLES_UPDATE_VIEW_OPTIONS_PATH = '/tables/updateViewOptions';
const TABLES_APPLY_VIEW_MANUAL_SORT_PATH = '/tables/applyViewManualSort';
const TABLES_UPDATE_VIEW_SHARE_META_PATH = '/tables/updateViewShareMeta';
const TABLES_REFRESH_VIEW_SHARE_ID_PATH = '/tables/refreshViewShareId';
const TABLES_ENABLE_VIEW_SHARE_PATH = '/tables/enableViewShare';
const TABLES_DISABLE_VIEW_SHARE_PATH = '/tables/disableViewShare';
const TABLES_GET_VIEW_FILTER_LINK_RECORDS_PATH = '/tables/getViewFilterLinkRecords';
const TABLES_GET_VIEW_SNAPSHOTS_PATH = '/tables/getViewSnapshots';
const TABLES_LIST_VIEW_DOC_IDS_PATH = '/tables/listViewDocIds';
const TABLES_INSTALL_VIEW_PLUGIN_PATH = '/tables/installViewPlugin';
const TABLES_GET_VIEW_PLUGIN_INSTALL_PATH = '/tables/getViewPluginInstall';
const TABLES_UPDATE_VIEW_PLUGIN_STORAGE_PATH = '/tables/updateViewPluginStorage';

const basesContract = {
  create: oc
    .route({
      method: 'POST',
      path: BASES_CREATE_PATH,
      successStatus: 201,
      summary: 'Create base',
      tags: ['bases'],
    })
    .input(createBaseInputSchema)
    .output(createBaseOkResponseSchema),
  duplicate: oc
    .route({
      method: 'POST',
      path: BASES_DUPLICATE_PATH,
      successStatus: 201,
      summary: 'Duplicate base',
      tags: ['bases'],
    })
    .input(duplicateBaseByIdInputSchema.omit({ targetBaseId: true }))
    .output(duplicateBaseOkResponseSchema),
  list: oc
    .route({
      method: 'GET',
      path: BASES_LIST_PATH,
      successStatus: 200,
      summary: 'List bases',
      tags: ['bases'],
    })
    .input(
      z.object({
        spaceId: z.string().optional(),
        search: z.string().optional(),
        orderBy: z.enum(['space', 'personal']).optional(),
        offset: jsonQuerySchema(z.number().int().min(0).default(0)),
        limit: jsonQuerySchema(z.number().int().min(1).max(200).default(20)),
      })
    )
    .output(
      z.object({
        ok: z.literal(true),
        data: z.object({ bases: baseListItemDtoSchema.array(), hasMore: z.boolean() }),
      })
    ),
} as const satisfies AnyContractRouter;

const tablesCreateContract = oc
  .route({
    method: 'POST',
    path: TABLES_CREATE_PATH,
    successStatus: 201,
    summary: 'Create table',
    tags: ['tables'],
  })
  .input(createTableInputSchema)
  .output(createTableOkResponseSchema);

const tablesCreateTablesContract = oc
  .route({
    method: 'POST',
    path: TABLES_CREATE_TABLES_PATH,
    successStatus: 201,
    summary: 'Create tables',
    tags: ['tables'],
  })
  .input(createTablesInputSchema)
  .output(createTablesOkResponseSchema);

const tablesCreateFieldContract = oc
  .route({
    method: 'POST',
    path: TABLES_CREATE_FIELD_PATH,
    successStatus: 200,
    summary: 'Create field',
    tags: ['tables'],
  })
  .input(createFieldInputSchema)
  .output(createFieldOkResponseSchema);

const tablesCreateViewContract = oc
  .route({
    method: 'POST',
    path: TABLES_CREATE_VIEW_PATH,
    successStatus: 200,
    summary: 'Create view',
    tags: ['tables'],
  })
  .input(createViewInputSchema)
  .output(createViewOkResponseSchema);

const tablesExplainCreateFieldContract = oc
  .route({
    method: 'POST',
    path: TABLES_EXPLAIN_CREATE_FIELD_PATH,
    successStatus: 200,
    summary: 'Explain create field',
    tags: ['tables'],
  })
  .input(explainCreateFieldInputSchema)
  .output(explainOkResponseSchema);

const tablesUpdateFieldContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_FIELD_PATH,
    successStatus: 200,
    summary: 'Update field',
    tags: ['tables'],
  })
  .input(updateFieldInputSchema)
  .output(updateFieldOkResponseSchema);

const tablesExplainUpdateFieldContract = oc
  .route({
    method: 'POST',
    path: TABLES_EXPLAIN_UPDATE_FIELD_PATH,
    successStatus: 200,
    summary: 'Explain update field',
    tags: ['tables'],
  })
  .input(explainUpdateFieldInputSchema)
  .output(explainOkResponseSchema);

const tablesUpdateRecordsContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_RECORDS_PATH,
    successStatus: 200,
    summary: 'Update multiple records by filter or recordIds',
    tags: ['tables'],
  })
  .input(updateRecordsInputSchema)
  .output(updateRecordsOkResponseSchema);

const tablesUpsertRecordsContract = oc
  .route({
    method: 'POST',
    path: '/tables/upsertRecords',
    successStatus: 200,
    summary: 'Upsert records by key',
    tags: ['tables'],
  })
  .input(upsertRecordsInputSchema)
  .output(upsertRecordsOkResponseSchema);

const tablesCreateRecordContract = oc
  .route({
    method: 'POST',
    path: TABLES_CREATE_RECORD_PATH,
    successStatus: 201,
    summary: 'Create record',
    tags: ['tables'],
  })
  .input(createRecordInputSchema)
  .output(createRecordOkResponseSchema);

const tablesSubmitRecordContract = oc
  .route({
    method: 'POST',
    path: TABLES_SUBMIT_RECORD_PATH,
    successStatus: 201,
    summary: 'Submit record from form',
    tags: ['tables'],
  })
  .input(submitRecordInputSchema)
  .output(submitRecordOkResponseSchema);

const tablesCreateRecordsContract = oc
  .route({
    method: 'POST',
    path: TABLES_CREATE_RECORDS_PATH,
    successStatus: 201,
    summary: 'Create multiple records',
    tags: ['tables'],
  })
  .input(createRecordsInputSchema)
  .output(createRecordsOkResponseSchema);

const tablesDeleteRecordsContract = oc
  .route({
    method: 'DELETE',
    path: TABLES_DELETE_RECORDS_PATH,
    successStatus: 200,
    summary: 'Delete records',
    tags: ['tables'],
  })
  .input(deleteRecordsInputSchema)
  .output(deleteRecordsOkResponseSchema);

const tablesDeleteFieldContract = oc
  .route({
    method: 'DELETE',
    path: TABLES_DELETE_FIELD_PATH,
    successStatus: 200,
    summary: 'Delete field',
    tags: ['tables'],
  })
  .input(deleteFieldInputSchema)
  .output(deleteFieldOkResponseSchema);

const tablesExplainDeleteFieldContract = oc
  .route({
    method: 'POST',
    path: TABLES_EXPLAIN_DELETE_FIELD_PATH,
    successStatus: 200,
    summary: 'Explain delete field',
    tags: ['tables'],
  })
  .input(explainDeleteFieldInputSchema)
  .output(explainOkResponseSchema);

const tablesExplainDeleteTableContract = oc
  .route({
    method: 'POST',
    path: TABLES_EXPLAIN_DELETE_TABLE_PATH,
    successStatus: 200,
    summary: 'Explain delete table',
    tags: ['tables'],
  })
  .input(explainDeleteTableInputSchema)
  .output(explainOkResponseSchema);

const tablesDeleteContract = oc
  .route({
    method: 'DELETE',
    path: TABLES_DELETE_PATH,
    successStatus: 200,
    summary: 'Delete table',
    tags: ['tables'],
  })
  .input(deleteTableInputSchema)
  .output(deleteTableOkResponseSchema);

const tablesRestoreContract = oc
  .route({
    method: 'POST',
    path: TABLES_RESTORE_PATH,
    successStatus: 200,
    summary: 'Restore table',
    tags: ['tables'],
  })
  .input(restoreTableInputSchema)
  .output(restoreTableOkResponseSchema);

const tablesGetByIdContract = oc
  .route({
    method: 'GET',
    path: TABLES_GET_PATH,
    successStatus: 200,
    summary: 'Get table by id',
    tags: ['tables'],
  })
  .input(getTableByIdInputSchema)
  .output(getTableByIdOkResponseSchema);

const tablesGetSchemaContract = oc
  .route({
    method: 'GET',
    path: '/tables/getSchema',
    successStatus: 200,
    summary: 'Get table schema by table id',
    tags: ['tables'],
  })
  .input(getSchemaInputSchema)
  .output(getTableByIdOkResponseSchema);

const tablesListFieldsContract = oc
  .route({
    method: 'GET',
    path: '/tables/listFields',
    successStatus: 200,
    summary: 'List readable field metadata',
    tags: ['tables'],
  })
  .input(listFieldsRequestSchema)
  .output(listFieldsOkResponseSchema);

const tablesGetComputeActivityContract = oc
  .route({
    method: 'GET',
    path: TABLES_GET_COMPUTE_ACTIVITY_PATH,
    successStatus: 200,
    summary: 'Get table compute activity and performance diagnostics',
    tags: ['tables'],
  })
  .input(getComputeActivityInputSchema)
  .output(getComputeActivityOkResponseSchema);

const tablesGetRecordContract = oc
  .route({
    method: 'GET',
    path: TABLES_GET_RECORD_PATH,
    successStatus: 200,
    summary: 'Get record by id',
    tags: ['tables'],
  })
  .input(
    getRecordByIdInputSchema.extend({
      projection: jsonQuerySchema(z.array(z.string().min(1))).optional(),
      includeOrders: booleanQuerySchema.optional(),
    })
  )
  .output(getRecordByIdOkResponseSchema);

const tablesGetViewContract = oc
  .route({
    method: 'GET',
    path: TABLES_GET_VIEW_PATH,
    successStatus: 200,
    summary: 'Get view',
    tags: ['tables'],
  })
  .input(getViewInputSchema)
  .output(getViewOkResponseSchema);

const tablesImportCsvContract = oc
  .route({
    method: 'POST',
    path: TABLES_IMPORT_CSV_PATH,
    successStatus: 201,
    summary: 'Import CSV to create table with records',
    tags: ['tables'],
  })
  .input(importCsvInputSchema)
  .output(importCsvOkResponseSchema);

const tablesImportRecordsContract = oc
  .route({
    method: 'POST',
    path: TABLES_IMPORT_RECORDS_PATH,
    successStatus: 200,
    summary: 'Import records into existing table',
    tags: ['tables'],
  })
  .input(importRecordsInputSchema)
  .output(importRecordsOkResponseSchema);

const tablesListRecordsContract = oc
  .route({
    method: 'GET',
    path: TABLES_LIST_RECORDS_PATH,
    successStatus: 200,
    summary: 'List table records',
    tags: ['tables'],
  })
  .input(listTableRecordsInputSchema)
  .output(listTableRecordsOkResponseSchema);

const tablesListContract = oc
  .route({
    method: 'GET',
    path: TABLES_LIST_PATH,
    successStatus: 200,
    summary: 'List tables',
    tags: ['tables'],
  })
  .input(listTablesInputSchema)
  .output(listTablesOkResponseSchema);

const tablesListViewsContract = oc
  .route({
    method: 'GET',
    path: TABLES_LIST_VIEWS_PATH,
    successStatus: 200,
    summary: 'List views',
    tags: ['tables'],
  })
  .input(listViewsInputSchema)
  .output(listViewsOkResponseSchema);

const tablesRenameContract = oc
  .route({
    method: 'POST',
    path: TABLES_RENAME_PATH,
    successStatus: 200,
    summary: 'Rename table',
    tags: ['tables'],
  })
  .input(renameTableInputSchema)
  .output(renameTableOkResponseSchema);

const tablesUpdatePropertiesContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_PROPERTIES_PATH,
    successStatus: 200,
    summary: 'Update table properties',
    tags: ['tables'],
  })
  .input(updateTablePropertiesInputSchema)
  .output(updateTablePropertiesOkResponseSchema);

const tablesUpdateRecordContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_RECORD_PATH,
    successStatus: 200,
    summary: 'Update record',
    tags: ['tables'],
  })
  .input(updateRecordInputSchema)
  .output(updateRecordOkResponseSchema);

const tablesReorderRecordsContract = oc
  .route({
    method: 'POST',
    path: TABLES_REORDER_RECORDS_PATH,
    successStatus: 200,
    summary: 'Reorder records',
    tags: ['tables'],
  })
  .input(reorderRecordsInputSchema)
  .output(reorderRecordsOkResponseSchema);

const tablesDuplicateFieldContract = oc
  .route({
    method: 'POST',
    path: TABLES_DUPLICATE_FIELD_PATH,
    successStatus: 200,
    summary: 'Duplicate field',
    tags: ['tables'],
  })
  .input(duplicateFieldInputSchema)
  .output(duplicateFieldOkResponseSchema);

const tablesDuplicateRecordContract = oc
  .route({
    method: 'POST',
    path: TABLES_DUPLICATE_RECORD_PATH,
    successStatus: 201,
    summary: 'Duplicate record',
    tags: ['tables'],
  })
  .input(duplicateRecordInputSchema)
  .output(duplicateRecordOkResponseSchema);

const tablesDuplicateTableContract = oc
  .route({
    method: 'POST',
    path: TABLES_DUPLICATE_TABLE_PATH,
    successStatus: 201,
    summary: 'Duplicate table',
    tags: ['tables'],
  })
  .input(duplicateTableInputSchema)
  .output(duplicateTableOkResponseSchema);

const tablesPasteContract = oc
  .route({
    method: 'POST',
    path: TABLES_PASTE_PATH,
    successStatus: 200,
    summary: 'Paste content to table cells',
    tags: ['tables'],
  })
  .input(pasteCommandInputSchema)
  .output(pasteOkResponseSchema);

const tablesClearContract = oc
  .route({
    method: 'POST',
    path: TABLES_CLEAR_PATH,
    successStatus: 200,
    summary: 'Clear cell values in selected range',
    tags: ['tables'],
  })
  .input(clearCommandInputSchema)
  .output(clearOkResponseSchema);

const tablesDeleteByRangeContract = oc
  .route({
    method: 'DELETE',
    path: TABLES_DELETE_BY_RANGE_PATH,
    successStatus: 200,
    summary: 'Delete records by range selection',
    tags: ['tables'],
  })
  .input(deleteByRangeCommandInputSchema)
  .output(deleteByRangeOkResponseSchema);

const tablesDeleteViewContract = oc
  .route({
    method: 'POST',
    path: TABLES_DELETE_VIEW_PATH,
    successStatus: 200,
    summary: 'Delete view',
    tags: ['tables'],
  })
  .input(deleteViewInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesDuplicateViewContract = oc
  .route({
    method: 'POST',
    path: TABLES_DUPLICATE_VIEW_PATH,
    successStatus: 200,
    summary: 'Duplicate view',
    tags: ['tables'],
  })
  .input(duplicateViewInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesRenameViewContract = oc
  .route({
    method: 'POST',
    path: TABLES_RENAME_VIEW_PATH,
    successStatus: 200,
    summary: 'Rename view',
    tags: ['tables'],
  })
  .input(renameViewInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesUpdateViewDescriptionContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_DESCRIPTION_PATH,
    successStatus: 200,
    summary: 'Update view description',
    tags: ['tables'],
  })
  .input(updateViewDescriptionInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesUpdateViewLockedContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_LOCKED_PATH,
    successStatus: 200,
    summary: 'Update view lock state',
    tags: ['tables'],
  })
  .input(updateViewLockedInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesUpdateViewOrderContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_ORDER_PATH,
    successStatus: 200,
    summary: 'Update view order',
    tags: ['tables'],
  })
  .input(updateViewOrderInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesUpdateViewColumnMetaContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_COLUMN_META_PATH,
    successStatus: 200,
    summary: 'Update view column metadata',
    tags: ['tables'],
  })
  .input(updateViewColumnMetaInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesUpdateViewFilterContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_FILTER_PATH,
    successStatus: 200,
    summary: 'Update view filter',
    tags: ['tables'],
  })
  .input(updateViewFilterInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesUpdateViewSortContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_SORT_PATH,
    successStatus: 200,
    summary: 'Update view sort',
    tags: ['tables'],
  })
  .input(updateViewSortInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesUpdateViewGroupContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_GROUP_PATH,
    successStatus: 200,
    summary: 'Update view group',
    tags: ['tables'],
  })
  .input(updateViewGroupInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesUpdateViewOptionsContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_OPTIONS_PATH,
    successStatus: 200,
    summary: 'Update view options',
    tags: ['tables'],
  })
  .input(updateViewOptionsInputSchema)
  .output(viewMutationOkResponseSchema);

const tablesApplyViewManualSortContract = oc
  .route({
    method: 'POST',
    path: TABLES_APPLY_VIEW_MANUAL_SORT_PATH,
    successStatus: 200,
    summary: 'Apply view manual sort',
    tags: ['tables'],
  })
  .input(applyViewManualSortInputSchema)
  .output(applyViewManualSortOkResponseSchema);

const tablesUpdateViewShareMetaContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_SHARE_META_PATH,
    successStatus: 200,
    summary: 'Update view share metadata',
    tags: ['tables'],
  })
  .input(updateViewShareMetaInputSchema)
  .output(viewShareStateOkResponseSchema);

const tablesRefreshViewShareIdContract = oc
  .route({
    method: 'POST',
    path: TABLES_REFRESH_VIEW_SHARE_ID_PATH,
    successStatus: 200,
    summary: 'Refresh view share ID',
    tags: ['tables'],
  })
  .input(refreshViewShareIdInputSchema)
  .output(viewShareMutationOkResponseSchema);

const tablesEnableViewShareContract = oc
  .route({
    method: 'POST',
    path: TABLES_ENABLE_VIEW_SHARE_PATH,
    successStatus: 200,
    summary: 'Enable view sharing',
    tags: ['tables'],
  })
  .input(enableViewShareInputSchema)
  .output(viewShareMutationOkResponseSchema);

const tablesDisableViewShareContract = oc
  .route({
    method: 'POST',
    path: TABLES_DISABLE_VIEW_SHARE_PATH,
    successStatus: 200,
    summary: 'Disable view sharing',
    tags: ['tables'],
  })
  .input(disableViewShareInputSchema)
  .output(viewShareStateOkResponseSchema);

const tablesGetViewFilterLinkRecordsContract = oc
  .route({
    method: 'GET',
    path: TABLES_GET_VIEW_FILTER_LINK_RECORDS_PATH,
    successStatus: 200,
    summary: 'Get records referenced by view filters',
    tags: ['tables'],
  })
  .input(getViewFilterLinkRecordsInputSchema)
  .output(getViewFilterLinkRecordsOkResponseSchema);

const tablesGetViewSnapshotsContract = oc
  .route({
    method: 'GET',
    path: TABLES_GET_VIEW_SNAPSHOTS_PATH,
    successStatus: 200,
    summary: 'Get view snapshots',
    tags: ['tables'],
  })
  .input(
    getViewSnapshotsInputSchema.extend({
      viewIds: jsonQuerySchema(z.array(z.string())),
    })
  )
  .output(getViewSnapshotsOkResponseSchema);

const tablesApplyViewSnapshotContract = oc
  .route({
    method: 'POST',
    path: '/tables/applyViewSnapshot',
    successStatus: 200,
    summary: 'Apply a view snapshot',
    tags: ['tables'],
  })
  .input(
    z
      .object({ tableId: z.string(), snapshot: viewSnapshotSchema.omit({ auditMetadata: true }) })
      .strict()
  )
  .output(applyViewSnapshotOkResponseSchema);

const tablesListViewDocIdsContract = oc
  .route({
    method: 'GET',
    path: TABLES_LIST_VIEW_DOC_IDS_PATH,
    successStatus: 200,
    summary: 'List view document IDs',
    tags: ['tables'],
  })
  .input(listViewsInputSchema)
  .output(listViewDocIdsOkResponseSchema);

const tablesInstallViewPluginContract = oc
  .route({
    method: 'POST',
    path: TABLES_INSTALL_VIEW_PLUGIN_PATH,
    successStatus: 200,
    summary: 'Install a plugin view',
    tags: ['tables'],
  })
  .input(installViewPluginInputSchema)
  .output(installViewPluginOkResponseSchema);

const tablesGetViewPluginInstallContract = oc
  .route({
    method: 'GET',
    path: TABLES_GET_VIEW_PLUGIN_INSTALL_PATH,
    successStatus: 200,
    summary: 'Get plugin view installation metadata',
    tags: ['tables'],
  })
  .input(getViewPluginInstallInputSchema)
  .output(getViewPluginInstallOkResponseSchema);

const tablesUpdateViewPluginStorageContract = oc
  .route({
    method: 'POST',
    path: TABLES_UPDATE_VIEW_PLUGIN_STORAGE_PATH,
    successStatus: 200,
    summary: 'Update plugin view storage',
    tags: ['tables'],
  })
  .input(updateViewPluginStorageInputSchema)
  .output(updateViewPluginStorageOkResponseSchema);

const tablesExplainCreateRecordContract = oc
  .route({
    method: 'POST',
    path: TABLES_EXPLAIN_CREATE_RECORD_PATH,
    successStatus: 200,
    summary: 'Explain create record command',
    tags: ['tables', 'explain'],
  })
  .input(explainCreateRecordInputSchema)
  .output(explainOkResponseSchema);

const tablesExplainUpdateRecordContract = oc
  .route({
    method: 'POST',
    path: TABLES_EXPLAIN_UPDATE_RECORD_PATH,
    successStatus: 200,
    summary: 'Explain update record command',
    tags: ['tables', 'explain'],
  })
  .input(explainUpdateRecordInputSchema)
  .output(explainOkResponseSchema);

const tablesExplainDeleteRecordsContract = oc
  .route({
    method: 'POST',
    path: TABLES_EXPLAIN_DELETE_RECORDS_PATH,
    successStatus: 200,
    summary: 'Explain delete records command',
    tags: ['tables', 'explain'],
  })
  .input(explainDeleteRecordsInputSchema)
  .output(explainOkResponseSchema);

type TablesContract = {
  readonly create: typeof tablesCreateContract;
  readonly createTables: typeof tablesCreateTablesContract;
  readonly createField: typeof tablesCreateFieldContract;
  readonly createView: typeof tablesCreateViewContract;
  readonly explainCreateField: typeof tablesExplainCreateFieldContract;
  readonly updateField: typeof tablesUpdateFieldContract;
  readonly explainUpdateField: typeof tablesExplainUpdateFieldContract;
  readonly updateRecords: typeof tablesUpdateRecordsContract;
  readonly upsertRecords: typeof tablesUpsertRecordsContract;
  readonly createRecord: typeof tablesCreateRecordContract;
  readonly submitRecord: typeof tablesSubmitRecordContract;
  readonly createRecords: typeof tablesCreateRecordsContract;
  readonly deleteRecords: typeof tablesDeleteRecordsContract;
  readonly deleteField: typeof tablesDeleteFieldContract;
  readonly explainDeleteField: typeof tablesExplainDeleteFieldContract;
  readonly explainDeleteTable: typeof tablesExplainDeleteTableContract;
  readonly delete: typeof tablesDeleteContract;
  readonly restore: typeof tablesRestoreContract;
  readonly getById: typeof tablesGetByIdContract;
  readonly getSchema: typeof tablesGetSchemaContract;
  readonly listFields: typeof tablesListFieldsContract;
  readonly getComputeActivity: typeof tablesGetComputeActivityContract;
  readonly getRecord: typeof tablesGetRecordContract;
  readonly getView: typeof tablesGetViewContract;
  readonly importCsv: typeof tablesImportCsvContract;
  readonly importRecords: typeof tablesImportRecordsContract;
  readonly listRecords: typeof tablesListRecordsContract;
  readonly list: typeof tablesListContract;
  readonly listViews: typeof tablesListViewsContract;
  readonly rename: typeof tablesRenameContract;
  readonly updateProperties: typeof tablesUpdatePropertiesContract;
  readonly updateRecord: typeof tablesUpdateRecordContract;
  readonly reorderRecords: typeof tablesReorderRecordsContract;
  readonly duplicateField: typeof tablesDuplicateFieldContract;
  readonly duplicateRecord: typeof tablesDuplicateRecordContract;
  readonly duplicateTable: typeof tablesDuplicateTableContract;
  readonly paste: typeof tablesPasteContract;
  readonly clear: typeof tablesClearContract;
  readonly deleteByRange: typeof tablesDeleteByRangeContract;
  readonly deleteView: typeof tablesDeleteViewContract;
  readonly duplicateView: typeof tablesDuplicateViewContract;
  readonly renameView: typeof tablesRenameViewContract;
  readonly updateViewDescription: typeof tablesUpdateViewDescriptionContract;
  readonly updateViewLocked: typeof tablesUpdateViewLockedContract;
  readonly updateViewOrder: typeof tablesUpdateViewOrderContract;
  readonly updateViewColumnMeta: typeof tablesUpdateViewColumnMetaContract;
  readonly updateViewFilter: typeof tablesUpdateViewFilterContract;
  readonly updateViewSort: typeof tablesUpdateViewSortContract;
  readonly updateViewGroup: typeof tablesUpdateViewGroupContract;
  readonly updateViewOptions: typeof tablesUpdateViewOptionsContract;
  readonly applyViewManualSort: typeof tablesApplyViewManualSortContract;
  readonly updateViewShareMeta: typeof tablesUpdateViewShareMetaContract;
  readonly refreshViewShareId: typeof tablesRefreshViewShareIdContract;
  readonly enableViewShare: typeof tablesEnableViewShareContract;
  readonly disableViewShare: typeof tablesDisableViewShareContract;
  readonly getViewFilterLinkRecords: typeof tablesGetViewFilterLinkRecordsContract;
  readonly getViewSnapshots: typeof tablesGetViewSnapshotsContract;
  readonly applyViewSnapshot: typeof tablesApplyViewSnapshotContract;
  readonly listViewDocIds: typeof tablesListViewDocIdsContract;
  readonly installViewPlugin: typeof tablesInstallViewPluginContract;
  readonly getViewPluginInstall: typeof tablesGetViewPluginInstallContract;
  readonly updateViewPluginStorage: typeof tablesUpdateViewPluginStorageContract;
  readonly explainCreateRecord: typeof tablesExplainCreateRecordContract;
  readonly explainUpdateRecord: typeof tablesExplainUpdateRecordContract;
  readonly explainDeleteRecords: typeof tablesExplainDeleteRecordsContract;
};

const tablesContract: TablesContract = {
  create: tablesCreateContract,
  createTables: tablesCreateTablesContract,
  createField: tablesCreateFieldContract,
  createView: tablesCreateViewContract,
  explainCreateField: tablesExplainCreateFieldContract,
  updateField: tablesUpdateFieldContract,
  explainUpdateField: tablesExplainUpdateFieldContract,
  updateRecords: tablesUpdateRecordsContract,
  upsertRecords: tablesUpsertRecordsContract,
  createRecord: tablesCreateRecordContract,
  submitRecord: tablesSubmitRecordContract,
  createRecords: tablesCreateRecordsContract,
  deleteRecords: tablesDeleteRecordsContract,
  deleteField: tablesDeleteFieldContract,
  explainDeleteField: tablesExplainDeleteFieldContract,
  explainDeleteTable: tablesExplainDeleteTableContract,
  delete: tablesDeleteContract,
  restore: tablesRestoreContract,
  getById: tablesGetByIdContract,
  getSchema: tablesGetSchemaContract,
  listFields: tablesListFieldsContract,
  getComputeActivity: tablesGetComputeActivityContract,
  getRecord: tablesGetRecordContract,
  getView: tablesGetViewContract,
  importCsv: tablesImportCsvContract,
  importRecords: tablesImportRecordsContract,
  listRecords: tablesListRecordsContract,
  list: tablesListContract,
  listViews: tablesListViewsContract,
  rename: tablesRenameContract,
  updateProperties: tablesUpdatePropertiesContract,
  updateRecord: tablesUpdateRecordContract,
  reorderRecords: tablesReorderRecordsContract,
  duplicateField: tablesDuplicateFieldContract,
  duplicateRecord: tablesDuplicateRecordContract,
  duplicateTable: tablesDuplicateTableContract,
  paste: tablesPasteContract,
  clear: tablesClearContract,
  deleteByRange: tablesDeleteByRangeContract,
  deleteView: tablesDeleteViewContract,
  duplicateView: tablesDuplicateViewContract,
  renameView: tablesRenameViewContract,
  updateViewDescription: tablesUpdateViewDescriptionContract,
  updateViewLocked: tablesUpdateViewLockedContract,
  updateViewOrder: tablesUpdateViewOrderContract,
  updateViewColumnMeta: tablesUpdateViewColumnMetaContract,
  updateViewFilter: tablesUpdateViewFilterContract,
  updateViewSort: tablesUpdateViewSortContract,
  updateViewGroup: tablesUpdateViewGroupContract,
  updateViewOptions: tablesUpdateViewOptionsContract,
  applyViewManualSort: tablesApplyViewManualSortContract,
  updateViewShareMeta: tablesUpdateViewShareMetaContract,
  refreshViewShareId: tablesRefreshViewShareIdContract,
  enableViewShare: tablesEnableViewShareContract,
  disableViewShare: tablesDisableViewShareContract,
  getViewFilterLinkRecords: tablesGetViewFilterLinkRecordsContract,
  getViewSnapshots: tablesGetViewSnapshotsContract,
  applyViewSnapshot: tablesApplyViewSnapshotContract,
  listViewDocIds: tablesListViewDocIdsContract,
  installViewPlugin: tablesInstallViewPluginContract,
  getViewPluginInstall: tablesGetViewPluginInstallContract,
  updateViewPluginStorage: tablesUpdateViewPluginStorageContract,
  explainCreateRecord: tablesExplainCreateRecordContract,
  explainUpdateRecord: tablesExplainUpdateRecordContract,
  explainDeleteRecords: tablesExplainDeleteRecordsContract,
};

const complexityContract = {
  assess: oc
    .route({
      method: 'POST',
      path: COMPLEXITY_ASSESS_PATH,
      successStatus: 200,
      summary: 'Assess table complexity',
      tags: ['complexity'],
    })
    .input(complexityAssessInputSchema)
    .output(complexityAssessOkResponseSchema),
  assessMatrix: oc
    .route({
      method: 'POST',
      path: COMPLEXITY_ASSESS_MATRIX_PATH,
      successStatus: 200,
      summary: 'Assess a field by operation matrix for one table',
      tags: ['complexity'],
    })
    .input(complexityAssessMatrixInputSchema)
    .output(complexityAssessMatrixOkResponseSchema),
} as const satisfies AnyContractRouter;

const operationPreviewContract = {
  preview: oc
    .route({
      method: 'POST',
      path: OPERATION_PREVIEW_PATH,
      successStatus: 200,
      summary: 'Preview a write operation',
      tags: ['operations', 'preview'],
    })
    .input(operationPreviewInputSchema)
    .output(operationPreviewOkResponseSchema),
  capabilities: oc
    .route({
      method: 'GET',
      path: OPERATION_PREVIEW_CAPABILITIES_PATH,
      successStatus: 200,
      summary: 'List operation preview capabilities',
      tags: ['operations', 'preview'],
    })
    .input(operationPreviewCapabilitiesInputSchema)
    .output(operationPreviewCapabilitiesOkResponseSchema),
} as const satisfies AnyContractRouter;

export type V2MemberContract = {
  readonly bases: typeof basesContract;
  readonly tables: typeof tablesContract;
  readonly operations: typeof operationPreviewContract;
  readonly complexity: typeof complexityContract;
  readonly workflows: typeof v2WorkflowContract;
};

export const v2MemberContract: V2MemberContract = {
  bases: basesContract,
  tables: tablesContract,
  operations: operationPreviewContract,
  complexity: complexityContract,
  workflows: v2WorkflowContract,
};

export type V2Contract = V2MemberContract & { readonly share: typeof v2ShareContract };
export const v2Contract: V2Contract = { ...v2MemberContract, share: v2ShareContract };

export const v2ContractErrors = {
  400: createTableErrorResponseSchema,
  404: deleteTableErrorResponseSchema,
  500: createTableErrorResponseSchema,
} as const;
