import type {
  ApplyViewManualSortResult,
  CreateViewResult,
  DomainError,
  GetViewFilterLinkRecordsResult,
  GetViewPluginInstallResult,
  GetViewSnapshotsResult,
  IDomainEvent,
  Table,
  UpdateViewPluginStorageResult,
  ViewId,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainEventDtoSchema, mapDomainEventToDto } from '../shared/domainEvent';
import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
} from '../shared/http';
import { mapTableToDto, tableDtoSchema, type ITableDto } from './dto';
import { viewReadDtoSchema } from './viewReadDto';

export const viewMutationResponseDataSchema = z.object({
  table: tableDtoSchema,
  viewId: z.string(),
  events: z.array(domainEventDtoSchema),
});

export type IViewMutationResponseDataDto = z.infer<typeof viewMutationResponseDataSchema>;
export type IViewMutationOkResponseDto = IApiOkResponseDto<IViewMutationResponseDataDto>;
export type IViewMutationEndpointResult =
  | { status: 200; body: IViewMutationOkResponseDto }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };

export const viewMutationOkResponseSchema = apiOkResponseDtoSchema(viewMutationResponseDataSchema);

export const viewShareMutationResponseDataSchema = z.object({
  viewId: z.string(),
  shareId: z.string(),
});
export type IViewShareMutationResponseDataDto = z.infer<typeof viewShareMutationResponseDataSchema>;
export type IViewShareMutationEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IViewShareMutationResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const viewShareMutationOkResponseSchema = apiOkResponseDtoSchema(
  viewShareMutationResponseDataSchema
);

export const viewShareStateResponseDataSchema = z.object({
  viewId: z.string(),
});
export type IViewShareStateResponseDataDto = z.infer<typeof viewShareStateResponseDataSchema>;
export type IViewShareStateEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IViewShareStateResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const viewShareStateOkResponseSchema = apiOkResponseDtoSchema(
  viewShareStateResponseDataSchema
);

export const applyViewManualSortResponseDataSchema = viewMutationResponseDataSchema.extend({
  updatedRecordCount: z.number().int().nonnegative(),
});
export type IApplyViewManualSortResponseDataDto = z.infer<
  typeof applyViewManualSortResponseDataSchema
>;
export type IApplyViewManualSortEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IApplyViewManualSortResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const applyViewManualSortOkResponseSchema = apiOkResponseDtoSchema(
  applyViewManualSortResponseDataSchema
);

type ViewMutationResult = {
  readonly table: Table;
  readonly viewId: ViewId;
  readonly events: ReadonlyArray<IDomainEvent>;
};

export const mapViewMutationResultToDto = (
  result: ViewMutationResult
): Result<IViewMutationResponseDataDto, DomainError> =>
  mapTableToDto(result.table).map((table) => ({
    table,
    viewId: result.viewId.toString(),
    events: result.events.map(mapDomainEventToDto),
  }));

export const mapViewShareMutationResultToDto = (result: {
  readonly viewId: ViewId;
  readonly shareId: string;
}): IViewShareMutationResponseDataDto => ({
  viewId: result.viewId.toString(),
  shareId: result.shareId,
});

export const mapViewShareStateResultToDto = (result: {
  readonly viewId: ViewId;
}): IViewShareStateResponseDataDto => ({
  viewId: result.viewId.toString(),
});

export const mapApplyViewManualSortResultToDto = (
  result: ApplyViewManualSortResult
): Result<IApplyViewManualSortResponseDataDto, DomainError> =>
  mapViewMutationResultToDto(result).map((mapped) => ({
    ...mapped,
    updatedRecordCount: result.updatedRecordCount,
  }));

export const getViewFilterLinkRecordsResponseDataSchema = z.object({
  groups: z.array(
    z.object({
      tableId: z.string(),
      records: z.array(z.object({ id: z.string(), title: z.string().optional() })),
    })
  ),
});
export type IGetViewFilterLinkRecordsResponseDataDto = z.infer<
  typeof getViewFilterLinkRecordsResponseDataSchema
>;
export type IGetViewFilterLinkRecordsEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IGetViewFilterLinkRecordsResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const getViewFilterLinkRecordsOkResponseSchema = apiOkResponseDtoSchema(
  getViewFilterLinkRecordsResponseDataSchema
);
export const mapGetViewFilterLinkRecordsResultToDto = (
  result: GetViewFilterLinkRecordsResult
): IGetViewFilterLinkRecordsResponseDataDto => ({
  groups: result.groups.map((group) => ({
    tableId: group.tableId,
    records: group.records.map((record) => ({ ...record })),
  })),
});

export const getViewSnapshotsResponseDataSchema = z.object({
  snapshots: z.array(
    z.object({
      id: z.string(),
      v: z.number().int().nonnegative(),
      type: z.literal('json0'),
      data: viewReadDtoSchema,
    })
  ),
});
export type IGetViewSnapshotsResponseDataDto = z.infer<typeof getViewSnapshotsResponseDataSchema>;
export type IGetViewSnapshotsEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IGetViewSnapshotsResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const getViewSnapshotsOkResponseSchema = apiOkResponseDtoSchema(
  getViewSnapshotsResponseDataSchema
);
export const mapGetViewSnapshotsResultToDto = (
  result: GetViewSnapshotsResult
): IGetViewSnapshotsResponseDataDto => ({
  snapshots: result.snapshots.map((snapshot) => ({
    id: snapshot.id,
    v: snapshot.version,
    type: 'json0',
    data: snapshot.view,
  })),
});

export const listViewDocIdsResponseDataSchema = z.object({ ids: z.array(z.string()) });
export type IListViewDocIdsResponseDataDto = z.infer<typeof listViewDocIdsResponseDataSchema>;
export type IListViewDocIdsEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IListViewDocIdsResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const listViewDocIdsOkResponseSchema = apiOkResponseDtoSchema(
  listViewDocIdsResponseDataSchema
);

export const getViewPluginInstallResponseDataSchema = z.object({
  pluginId: z.string(),
  pluginInstallId: z.string(),
  baseId: z.string(),
  name: z.string(),
  url: z.string().optional(),
  storage: z.record(z.string(), z.unknown()).optional(),
});
export type IGetViewPluginInstallResponseDataDto = z.infer<
  typeof getViewPluginInstallResponseDataSchema
>;
export type IGetViewPluginInstallEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IGetViewPluginInstallResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const getViewPluginInstallOkResponseSchema = apiOkResponseDtoSchema(
  getViewPluginInstallResponseDataSchema
);
export const mapGetViewPluginInstallResultToDto = (
  result: GetViewPluginInstallResult
): IGetViewPluginInstallResponseDataDto => ({
  pluginId: result.installation.pluginId,
  pluginInstallId: result.installation.id,
  baseId: result.installation.baseId,
  name: result.installation.name,
  ...(result.installation.url !== undefined ? { url: result.installation.url } : {}),
  ...(result.installation.storage !== undefined
    ? { storage: { ...result.installation.storage } }
    : {}),
});

export const installViewPluginInputSchema = z
  .object({
    tableId: z.string(),
    pluginId: z.string().min(1),
    name: z.string().optional(),
  })
  .strict();

export const installViewPluginResponseDataSchema = z.object({
  table: tableDtoSchema,
  viewId: z.string(),
  pluginId: z.string(),
  pluginInstallId: z.string(),
  name: z.string(),
  events: z.array(domainEventDtoSchema),
});
export type IInstallViewPluginResponseDataDto = z.infer<typeof installViewPluginResponseDataSchema>;
export type IInstallViewPluginEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IInstallViewPluginResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const installViewPluginOkResponseSchema = apiOkResponseDtoSchema(
  installViewPluginResponseDataSchema
);

export const mapInstallViewPluginResultToDto = (
  result: CreateViewResult
): Result<IInstallViewPluginResponseDataDto, DomainError> =>
  result.table.getView(result.viewId).andThen((view) =>
    mapTableToDto(result.table).map((table: ITableDto) => {
      const options = view.options() as { pluginId: string; pluginInstallId: string };
      return {
        table,
        viewId: result.viewId.toString(),
        pluginId: options.pluginId,
        pluginInstallId: options.pluginInstallId,
        name: view.name().toString(),
        events: result.events.map(mapDomainEventToDto),
      };
    })
  );

export const updateViewPluginStorageResponseDataSchema = z.object({
  tableId: z.string(),
  viewId: z.string(),
  pluginInstallId: z.string(),
  storage: z.record(z.string(), z.unknown()).optional(),
});
export type IUpdateViewPluginStorageResponseDataDto = z.infer<
  typeof updateViewPluginStorageResponseDataSchema
>;
export type IUpdateViewPluginStorageEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IUpdateViewPluginStorageResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };
export const updateViewPluginStorageOkResponseSchema = apiOkResponseDtoSchema(
  updateViewPluginStorageResponseDataSchema
);
export const mapUpdateViewPluginStorageResultToDto = (
  result: UpdateViewPluginStorageResult
): IUpdateViewPluginStorageResponseDataDto => ({
  tableId: result.tableId,
  viewId: result.viewId,
  pluginInstallId: result.pluginInstallId,
  ...(result.storage !== undefined ? { storage: { ...result.storage } } : {}),
});

export const viewOperationsErrorResponseSchema = apiErrorResponseDtoSchema;
