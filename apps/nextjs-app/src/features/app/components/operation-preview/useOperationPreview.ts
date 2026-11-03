import { useQuery } from '@tanstack/react-query';
import { getAxios } from '@teable/openapi';
import {
  OPERATION_PREVIEW_PATH,
  operationPreviewOkResponseSchema,
} from '@teable/v2-contract-http/operationPreview';
import type { IOperationPreviewRequestDto } from '@teable/v2-contract-http/operationPreview';

/** The complete pending write input is part of the cache identity; never retain another input's result. */
export const useOperationPreview = (request: IOperationPreviewRequestDto, enabled: boolean) => {
  const query = useQuery({
    queryKey: ['operation-preview', request],
    queryFn: async ({ signal }) => {
      const response = await getAxios().post(`/v2${OPERATION_PREVIEW_PATH}`, request, { signal });
      const parsed = operationPreviewOkResponseSchema.safeParse(response.data);
      if (!parsed.success || parsed.data.data.operation !== request.operation) {
        throw new Error('operation.preview.invalid_response');
      }
      return parsed.data.data;
    },
    enabled,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    meta: { preventGlobalError: true },
  });

  return {
    ...query,
    canConfirm:
      enabled &&
      query.isSuccess &&
      !query.isFetching &&
      !query.error &&
      query.data.outcome !== 'blocked' &&
      query.data.blockers.length === 0,
  };
};
