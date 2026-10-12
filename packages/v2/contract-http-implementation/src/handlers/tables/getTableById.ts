import type { IGetTableByIdEndpointResult } from '@teable/v2-contract-http';
import {
  enrichTableDtoWithComputeActivity,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapGetTableByIdResultToDto,
} from '@teable/v2-contract-http';
import { GetComputeActivityQuery, GetTableByIdQuery } from '@teable/v2-core';
import type {
  GetTableByIdResult,
  GetComputeActivityResult,
  IComputedActivityReader,
  IExecutionContext,
  IQueryBus,
} from '@teable/v2-core';

export const executeGetTableByIdEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus,
  activityReader?: IComputedActivityReader
): Promise<IGetTableByIdEndpointResult> => {
  const queryResult = GetTableByIdQuery.create(rawInput);
  if (queryResult.isErr()) {
    const error = queryResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
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

  const mapped = mapGetTableByIdResultToDto(result.value);
  if (mapped.isErr()) {
    const error = mapped.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  let table = enrichTableDtoWithComputeActivity(mapped.value.table, null);
  if (activityReader) {
    // Reuse the dedicated activity query's record/field authorization. The raw
    // reader is infrastructure and must never enrich a public response directly.
    const activityQuery = GetComputeActivityQuery.create(rawInput);
    if (activityQuery.isOk()) {
      try {
        const activity = await queryBus.execute<GetComputeActivityQuery, GetComputeActivityResult>(
          context,
          activityQuery.value
        );
        if (activity.isOk()) {
          table = enrichTableDtoWithComputeActivity(mapped.value.table, activity.value.snapshot);
        }
      } catch {
        // Activity is supplementary: a permission or observation failure must not
        // fail table metadata reads or claim a healthy calculation state.
      }
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: { table },
    },
  };
};
