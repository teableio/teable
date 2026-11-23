import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapFieldToDto,
  type IFieldDto,
  type IListFieldsEndpointResult,
} from '@teable/v2-contract-http';
import {
  ListFieldsQuery,
  type IExecutionContext,
  type IQueryBus,
  type ListFieldsResult,
} from '@teable/v2-core';

export const executeListFieldsEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus
): Promise<IListFieldsEndpointResult> => {
  const query = ListFieldsQuery.create(rawInput);
  if (query.isErr()) {
    return {
      status: mapDomainErrorToHttpStatus(query.error),
      body: { ok: false, error: mapDomainErrorToHttpError(query.error) },
    };
  }
  const result = await queryBus.execute<ListFieldsQuery, ListFieldsResult>(context, query.value);
  if (result.isErr()) {
    return {
      status: mapDomainErrorToHttpStatus(result.error),
      body: { ok: false, error: mapDomainErrorToHttpError(result.error) },
    };
  }
  const fields: IFieldDto[] = [];
  for (const field of result.value.fields) {
    const dto = mapFieldToDto(field, result.value.primaryFieldId);
    if (dto.isErr()) {
      return {
        status: mapDomainErrorToHttpStatus(dto.error),
        body: { ok: false, error: mapDomainErrorToHttpError(dto.error) },
      };
    }
    fields.push(dto.value);
  }
  return { status: 200, body: { ok: true, data: { fields } } };
};
