import type { IHandlerResolver } from '@teable/v2-contract-http';
import { prepareRecordRead } from './prepareRecordRead';
import type { IListTableRecordsEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapListTableRecordsResultToDto,
} from '@teable/v2-contract-http';
import { ListTableRecordsQuery, RecordQueryOperationKind } from '@teable/v2-core';
import type {
  IExecutionContext,
  IQueryBus,
  IRecordReadQuerySource,
  IRecordSearchAccessPath,
  ListTableRecordsResult,
  RecordQueryPluginScope,
  Table,
} from '@teable/v2-core';

export interface IListTableRecordsEndpointOptions {
  readonly container?: IHandlerResolver;
  readonly queryScope?: RecordQueryPluginScope;
  /** @deprecated Prefer queryScope */
  readonly recordReadQuerySource?: IRecordReadQuerySource;
  readonly recordSearchAccessPath?: IRecordSearchAccessPath;
  readonly table?: Table;
}

export const executeListTableRecordsEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus,
  options?: IListTableRecordsEndpointOptions
): Promise<IListTableRecordsEndpointResult> => {
  const parsedQuery = ListTableRecordsQuery.create(rawInput, options);
  if (parsedQuery.isErr()) {
    return { status: mapDomainErrorToHttpStatus(parsedQuery.error), body: { ok: false, error: mapDomainErrorToHttpError(parsedQuery.error) } };
  }
  let effectiveOptions = options;
  if (options?.container) {
    const query = parsedQuery.value;
    const prepared = await prepareRecordRead(context, query.tableId.toString(), options.container, {
      kind: RecordQueryOperationKind.list,
      payload: { viewId: query.viewId, ignoreViewQuery: query.ignoreViewQuery, projectionFieldIds: query.projection, limit: query.pagination.limit().toNumber(), offset: query.pagination.offset().toNumber(), keepPrimaryKey: Boolean(query.filterLinkCellSelected) },
    });
    if (prepared.isErr()) {
      return { status: mapDomainErrorToHttpStatus(prepared.error), body: { ok: false, error: mapDomainErrorToHttpError(prepared.error) } };
    }
    effectiveOptions = { ...options, ...prepared.value };
  }
  const queryResult = ListTableRecordsQuery.create(rawInput, effectiveOptions);
  if (queryResult.isErr()) {
    const error = queryResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
    context,
    queryResult.value
  );
  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const mapped = mapListTableRecordsResultToDto(result.value);
  if (mapped.isErr()) {
    const error = mapped.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: mapped.value,
    },
  };
};
