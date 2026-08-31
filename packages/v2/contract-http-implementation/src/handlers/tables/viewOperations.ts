import {
  installViewPluginInputSchema,
  mapApplyViewManualSortResultToDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapGetViewFilterLinkRecordsResultToDto,
  mapGetViewPluginInstallResultToDto,
  mapGetViewSnapshotsResultToDto,
  mapInstallViewPluginResultToDto,
  mapUpdateViewPluginStorageResultToDto,
  mapViewMutationResultToDto,
  mapViewShareMutationResultToDto,
  mapViewShareStateResultToDto,
} from '@teable/v2-contract-http';
import type {
  HttpErrorStatus,
  IApiErrorResponseDto,
  IApiOkResponseDto,
  IApplyViewManualSortResponseDataDto,
  IGetViewFilterLinkRecordsResponseDataDto,
  IGetViewPluginInstallResponseDataDto,
  IGetViewSnapshotsResponseDataDto,
  IInstallViewPluginResponseDataDto,
  IUpdateViewPluginStorageResponseDataDto,
  IViewMutationResponseDataDto,
  IViewShareMutationResponseDataDto,
  IViewShareStateResponseDataDto,
} from '@teable/v2-contract-http';
import {
  ApplyViewManualSortCommand,
  type ApplyViewManualSortResult,
  CreateViewCommand,
  type CreateViewResult,
  DeleteViewCommand,
  type DeleteViewResult,
  DisableViewShareCommand,
  type DisableViewShareResult,
  domainError,
  DuplicateViewCommand,
  type DuplicateViewResult,
  EnableViewShareCommand,
  type EnableViewShareResult,
  GetViewFilterLinkRecordsQuery,
  type GetViewFilterLinkRecordsResult,
  GetViewPluginInstallQuery,
  type GetViewPluginInstallResult,
  GetViewSnapshotsQuery,
  type GetViewSnapshotsResult,
  type ICommandBus,
  type DomainError,
  type IExecutionContext,
  type IPublicCommand,
  type Result,
  type IQueryBus,
  ListViewsQuery,
  type ListViewsResult,
  RefreshViewShareIdCommand,
  type RefreshViewShareIdResult,
  RenameViewCommand,
  type RenameViewResult,
  UpdateViewColumnMetaCommand,
  type UpdateViewColumnMetaResult,
  UpdateViewDescriptionCommand,
  type UpdateViewDescriptionResult,
  UpdateViewFilterCommand,
  type UpdateViewFilterResult,
  UpdateViewGroupCommand,
  type UpdateViewGroupResult,
  UpdateViewLockedCommand,
  type UpdateViewLockedResult,
  UpdateViewOptionsCommand,
  type UpdateViewOptionsResult,
  UpdateViewOrderCommand,
  type UpdateViewOrderResult,
  UpdateViewPluginStorageCommand,
  type UpdateViewPluginStorageResult,
  UpdateViewShareMetaCommand,
  type UpdateViewShareMetaResult,
  UpdateViewSortCommand,
  type UpdateViewSortResult,
} from '@teable/v2-core';

type EndpointResult<TData> =
  | { status: 200; body: IApiOkResponseDto<TData> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };

type Factory<T> = {
  create(raw: unknown): Result<T, DomainError>;
};

const errorEndpointResult = <TData>(error: DomainError): EndpointResult<TData> => ({
  status: mapDomainErrorToHttpStatus(error),
  body: { ok: false, error: mapDomainErrorToHttpError(error) },
});

const executeCommand = async <TCommand extends IPublicCommand, TResult, TData>(
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus,
  factory: Factory<TCommand>,
  mapResult: (result: TResult) => Result<TData, DomainError>
): Promise<EndpointResult<TData>> => {
  const commandResult = factory.create(rawBody);
  if (commandResult.isErr()) return errorEndpointResult(commandResult.error);

  const result = await commandBus.execute<TCommand, TResult>(context, commandResult.value);
  if (result.isErr()) return errorEndpointResult(result.error);

  const mapped = mapResult(result.value);
  if (mapped.isErr()) return errorEndpointResult(mapped.error);
  return { status: 200, body: { ok: true, data: mapped.value } };
};

const executePlainCommand = async <TCommand extends IPublicCommand, TResult, TData>(
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus,
  factory: Factory<TCommand>,
  mapResult: (result: TResult) => TData
): Promise<EndpointResult<TData>> => {
  const commandResult = factory.create(rawBody);
  if (commandResult.isErr()) return errorEndpointResult(commandResult.error);

  const result = await commandBus.execute<TCommand, TResult>(context, commandResult.value);
  if (result.isErr()) return errorEndpointResult(result.error);
  return { status: 200, body: { ok: true, data: mapResult(result.value) } };
};

const executeQuery = async <TQuery, TResult, TData>(
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus,
  factory: Factory<TQuery>,
  mapResult: (result: TResult) => TData
): Promise<EndpointResult<TData>> => {
  const queryResult = factory.create(rawInput);
  if (queryResult.isErr()) return errorEndpointResult(queryResult.error);

  const result = await queryBus.execute<TQuery, TResult>(context, queryResult.value);
  if (result.isErr()) return errorEndpointResult(result.error);
  return { status: 200, body: { ok: true, data: mapResult(result.value) } };
};

export const executeDeleteViewEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeCommand<DeleteViewCommand, DeleteViewResult, IViewMutationResponseDataDto>(
    context,
    input,
    commandBus,
    DeleteViewCommand,
    mapViewMutationResultToDto
  );

export const executeDuplicateViewEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeCommand<DuplicateViewCommand, DuplicateViewResult, IViewMutationResponseDataDto>(
    context,
    input,
    commandBus,
    DuplicateViewCommand,
    mapViewMutationResultToDto
  );

type ViewMutationResult = Parameters<typeof mapViewMutationResultToDto>[0];

const executeMutation = <TCommand extends IPublicCommand, TResult extends ViewMutationResult>(
  factory: Factory<TCommand>,
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeCommand<TCommand, TResult, IViewMutationResponseDataDto>(
    context,
    input,
    commandBus,
    factory,
    mapViewMutationResultToDto
  );

export const executeRenameViewEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<RenameViewCommand, RenameViewResult>(
    RenameViewCommand,
    context,
    input,
    commandBus
  );

export const executeUpdateViewDescriptionEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<UpdateViewDescriptionCommand, UpdateViewDescriptionResult>(
    UpdateViewDescriptionCommand,
    context,
    input,
    commandBus
  );

export const executeUpdateViewLockedEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<UpdateViewLockedCommand, UpdateViewLockedResult>(
    UpdateViewLockedCommand,
    context,
    input,
    commandBus
  );

export const executeUpdateViewOrderEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<UpdateViewOrderCommand, UpdateViewOrderResult>(
    UpdateViewOrderCommand,
    context,
    input,
    commandBus
  );

export const executeUpdateViewColumnMetaEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<UpdateViewColumnMetaCommand, UpdateViewColumnMetaResult>(
    UpdateViewColumnMetaCommand,
    context,
    input,
    commandBus
  );

export const executeUpdateViewFilterEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<UpdateViewFilterCommand, UpdateViewFilterResult>(
    UpdateViewFilterCommand,
    context,
    input,
    commandBus
  );

export const executeUpdateViewSortEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<UpdateViewSortCommand, UpdateViewSortResult>(
    UpdateViewSortCommand,
    context,
    input,
    commandBus
  );

export const executeUpdateViewGroupEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<UpdateViewGroupCommand, UpdateViewGroupResult>(
    UpdateViewGroupCommand,
    context,
    input,
    commandBus
  );

export const executeUpdateViewOptionsEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeMutation<UpdateViewOptionsCommand, UpdateViewOptionsResult>(
    UpdateViewOptionsCommand,
    context,
    input,
    commandBus
  );

export const executeApplyViewManualSortEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executeCommand<
    ApplyViewManualSortCommand,
    ApplyViewManualSortResult,
    IApplyViewManualSortResponseDataDto
  >(context, input, commandBus, ApplyViewManualSortCommand, mapApplyViewManualSortResultToDto);

export const executeUpdateViewShareMetaEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executePlainCommand<
    UpdateViewShareMetaCommand,
    UpdateViewShareMetaResult,
    IViewShareStateResponseDataDto
  >(context, input, commandBus, UpdateViewShareMetaCommand, mapViewShareStateResultToDto);

export const executeRefreshViewShareIdEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executePlainCommand<
    RefreshViewShareIdCommand,
    RefreshViewShareIdResult,
    IViewShareMutationResponseDataDto
  >(context, input, commandBus, RefreshViewShareIdCommand, mapViewShareMutationResultToDto);

export const executeEnableViewShareEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executePlainCommand<
    EnableViewShareCommand,
    EnableViewShareResult,
    IViewShareMutationResponseDataDto
  >(context, input, commandBus, EnableViewShareCommand, mapViewShareMutationResultToDto);

export const executeDisableViewShareEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executePlainCommand<
    DisableViewShareCommand,
    DisableViewShareResult,
    IViewShareStateResponseDataDto
  >(context, input, commandBus, DisableViewShareCommand, mapViewShareStateResultToDto);

export const executeInstallViewPluginEndpoint = async (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) => {
  const parsed = installViewPluginInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorEndpointResult(
      domainError.validation({
        message: 'Invalid install View plugin input',
        details: parsed.error.flatten(),
      })
    );
  }
  return executeCommand<CreateViewCommand, CreateViewResult, IInstallViewPluginResponseDataDto>(
    context,
    {
      tableId: parsed.data.tableId,
      view: {
        type: 'plugin',
        name: parsed.data.name,
        options: { pluginId: parsed.data.pluginId },
      },
    },
    commandBus,
    CreateViewCommand,
    mapInstallViewPluginResultToDto
  );
};

export const executeUpdateViewPluginStorageEndpoint = (
  context: IExecutionContext,
  input: unknown,
  commandBus: ICommandBus
) =>
  executePlainCommand<
    UpdateViewPluginStorageCommand,
    UpdateViewPluginStorageResult,
    IUpdateViewPluginStorageResponseDataDto
  >(
    context,
    input,
    commandBus,
    UpdateViewPluginStorageCommand,
    mapUpdateViewPluginStorageResultToDto
  );

export const executeGetViewFilterLinkRecordsEndpoint = (
  context: IExecutionContext,
  input: unknown,
  queryBus: IQueryBus
) =>
  executeQuery<
    GetViewFilterLinkRecordsQuery,
    GetViewFilterLinkRecordsResult,
    IGetViewFilterLinkRecordsResponseDataDto
  >(
    context,
    input,
    queryBus,
    GetViewFilterLinkRecordsQuery,
    mapGetViewFilterLinkRecordsResultToDto
  );

export const executeGetViewSnapshotsEndpoint = (
  context: IExecutionContext,
  input: unknown,
  queryBus: IQueryBus
) =>
  executeQuery<GetViewSnapshotsQuery, GetViewSnapshotsResult, IGetViewSnapshotsResponseDataDto>(
    context,
    input,
    queryBus,
    GetViewSnapshotsQuery,
    mapGetViewSnapshotsResultToDto
  );

export const executeListViewDocIdsEndpoint = (
  context: IExecutionContext,
  input: unknown,
  queryBus: IQueryBus
) =>
  executeQuery<ListViewsQuery, ListViewsResult, { ids: string[] }>(
    context,
    input,
    queryBus,
    ListViewsQuery,
    (result) => ({ ids: result.views.map((view) => view.id) })
  );

export const executeGetViewPluginInstallEndpoint = (
  context: IExecutionContext,
  input: unknown,
  queryBus: IQueryBus
) =>
  executeQuery<
    GetViewPluginInstallQuery,
    GetViewPluginInstallResult,
    IGetViewPluginInstallResponseDataDto
  >(context, input, queryBus, GetViewPluginInstallQuery, mapGetViewPluginInstallResultToDto);
