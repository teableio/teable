import type { IHandlerResolver } from '@teable/v2-contract-http';
import { domainError, GetRecordByIdResult, ListTableRecordsQuery, RecordQueryOperationKind, type ListTableRecordsResult } from '@teable/v2-core';
import { prepareRecordRead } from './prepareRecordRead';
import type { IGetRecordByIdEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapGetRecordByIdResultToDto,
} from '@teable/v2-contract-http';
import { GetRecordByIdQuery } from '@teable/v2-core';
import type { IExecutionContext, IQueryBus } from '@teable/v2-core';

export const executeGetRecordByIdEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus,
  options?: { container?: IHandlerResolver }
): Promise<IGetRecordByIdEndpointResult> => {
  const queryResult = GetRecordByIdQuery.create(rawInput);
  if (queryResult.isErr()) {
    const error = queryResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  if (options?.container) {
    const query = queryResult.value;
    const prepared = await prepareRecordRead(context, query.tableId.toString(), options.container, {
      kind: RecordQueryOperationKind.getOne,
      payload: { recordId: query.recordId.toString(), projectionFieldIds: query.projection, viewId: query.viewId },
    });
    if (prepared.isErr()) return { status: mapDomainErrorToHttpStatus(prepared.error), body: { ok: false, error: mapDomainErrorToHttpError(prepared.error) } };
    const listQuery = ListTableRecordsQuery.create({
      tableId: query.tableId.toString(), selectedRecordIds: [query.recordId.toString()], limit: 1,
      fieldKeyType: query.fieldKeyType, projection: query.projection, cellFormat: query.cellFormat,
      includeOrders: query.includeOrders, viewId: query.viewId, ignoreViewQuery: true,
    }, prepared.value);
    if (listQuery.isErr()) return { status: mapDomainErrorToHttpStatus(listQuery.error), body: { ok: false, error: mapDomainErrorToHttpError(listQuery.error) } };
    const records = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(context, listQuery.value);
    if (records.isErr()) return { status: mapDomainErrorToHttpStatus(records.error), body: { ok: false, error: mapDomainErrorToHttpError(records.error) } };
    const record = records.value.records[0];
    if (!record) {
      const error = domainError.notFound({ code: 'record.not_found', message: 'Record not found' });
      return { status: 404, body: { ok: false, error: mapDomainErrorToHttpError(error) } };
    }
    const mapped = mapGetRecordByIdResultToDto(GetRecordByIdResult.create(record));
    if (mapped.isErr()) return { status: mapDomainErrorToHttpStatus(mapped.error), body: { ok: false, error: mapDomainErrorToHttpError(mapped.error) } };
    return { status: 200, body: { ok: true, data: mapped.value } };
  }

  const result = await queryBus.execute<GetRecordByIdQuery, GetRecordByIdResult>(
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

  const mapped = mapGetRecordByIdResultToDto(result.value);
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
