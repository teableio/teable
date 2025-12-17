/* eslint-disable @typescript-eslint/no-explicit-any */
import type { QueryClient } from '@tanstack/react-query';
import type { IGetBaseVo } from '@teable/openapi';
import { IS_TEMPLATE_HEADER } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { SsrApi } from '@/backend/api/rest/ssr-api';

export default async function handleBase<T extends SsrApi = SsrApi>(
  baseId: string,
  ssrApi: T,
  queryClient: QueryClient
): Promise<IGetBaseVo> {
  const base = await queryClient.fetchQuery({
    queryKey: ReactQueryKeys.base(baseId),
    queryFn: ({ queryKey }) => ssrApi.getBaseById(queryKey[1]),
  });
  const templateHeader = base?.template?.headers;
  if (templateHeader) {
    ssrApi.disableLastVisit = true;
    ssrApi.axios.interceptors.request.use((config) => {
      config.headers[IS_TEMPLATE_HEADER] = templateHeader;
      return config;
    });
  }
  return base;
}
