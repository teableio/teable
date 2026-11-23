import type { IGetSchemaRequestDto, IGetTableByIdEndpointResult } from '@teable/v2-contract-http';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import { domainError, TableId, v2CoreTokens, type IExecutionContext, type IQueryBus, type TableQueryService } from '@teable/v2-core';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import { executeGetTableByIdEndpoint } from './getTableById';

export const executeGetSchemaEndpoint = async (
  context: IExecutionContext,
  input: IGetSchemaRequestDto,
  container: IHandlerResolver
): Promise<IGetTableByIdEndpointResult> => {
  const tableId = TableId.create(input.tableId);
  if (tableId.isErr()) return { status: mapDomainErrorToHttpStatus(tableId.error), body: { ok: false, error: mapDomainErrorToHttpError(tableId.error) } };
  const table = await container.resolve<TableQueryService>(v2CoreTokens.tableQueryService).getById(context, tableId.value);
  if (table.isErr()) return { status: mapDomainErrorToHttpStatus(table.error), body: { ok: false, error: mapDomainErrorToHttpError(table.error) } };
  const result = await executeGetTableByIdEndpoint(context, { tableId: input.tableId, baseId: table.value.baseId().toString() }, container.resolve<IQueryBus>(v2CoreTokens.queryBus));
  if (result.status !== 200) return result;
  const dto = result.body.data.table;
  const view = input.viewId ? dto.views.find((candidate) => candidate.id === input.viewId) : undefined;
  if (input.viewId && !view) return { status: 404, body: { ok: false, error: mapDomainErrorToHttpError(domainError.notFound({ code: 'view.not_found', message: 'View not found' })) } };
  const selected = input.projection ? new Set(input.projection) : undefined;
  dto.fields = dto.fields.filter((field) => (!selected || selected.has(field.id)) && (!input.filterHidden || !view?.columnMeta[field.id]?.hidden));
  if (view) dto.fields.sort((a, b) => (view.columnMeta[a.id]?.order ?? 0) - (view.columnMeta[b.id]?.order ?? 0));
  return result;
};
