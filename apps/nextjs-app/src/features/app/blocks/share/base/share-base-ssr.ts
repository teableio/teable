import { QueryClient } from '@tanstack/react-query';
import type { IHttpError } from '@teable/core';
import { ANONYMOUS_USER } from '@teable/core';
import type { IGetBaseShareVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { IUser } from '@teable/sdk/context';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type { SsrApi } from '@/backend/api/rest/ssr-api';
import type { ISSRContext } from '@/features/app/base-node';
import type { IBaseNodePageProps } from '@/features/app/base-node/types';
import { parseBaseSlug } from '@/features/app/hooks/useBaseResource';
import { baseAllConfig } from '@/features/i18n/base-all.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { I18nNamespace } from '@/lib/i18n';

export interface IShareBasePagePropsBase extends IBaseNodePageProps {
  shareId: string;
  user?: IUser;
  shareNodeId?: string;
  allowSave?: boolean;
  allowCopy?: boolean;
}

export const getCurrentUser = async (ssrApi: SsrApi) => {
  try {
    return await ssrApi.getUserMe();
  } catch {
    return ANONYMOUS_USER;
  }
};

export const handleShareError = <T extends IShareBasePagePropsBase>(
  e: unknown,
  shareId: string
): GetServerSidePropsResult<T> => {
  const error = e as IHttpError;
  if (error.status === 401) {
    return { redirect: { destination: `/share/${shareId}/base/auth`, permanent: false } };
  }
  return { notFound: true };
};

export const buildShareProps = async <T extends IShareBasePagePropsBase>(
  pageProps: { props: IBaseNodePageProps | Promise<IBaseNodePageProps> },
  shareId: string,
  user: IUser,
  shareData: IGetBaseShareVo,
  extraProps?: Partial<T>
): Promise<GetServerSidePropsResult<T>> => {
  const props = await pageProps.props;
  return {
    props: {
      ...props,
      shareId,
      user,
      shareNodeId: shareData.shareMeta?.nodeId,
      allowSave: !!shareData?.shareMeta?.allowSave,
      allowCopy: !!shareData?.shareMeta?.allowCopy,
      ...extraProps,
    } as T,
  };
};

export interface IShareBaseSSROptions<T extends IShareBasePagePropsBase> {
  ssrApi: SsrApi;
  context: GetServerSidePropsContext;
  getResourcePageProps: (
    ctx: ISSRContext,
    parsed: ReturnType<typeof parseBaseSlug>,
    queryParams: Record<string, string | string[] | undefined>
  ) => Promise<GetServerSidePropsResult<IBaseNodePageProps> | null>;
  getExtraProps?: (pageProps: IBaseNodePageProps) => Partial<T>;
  i18nNamespaces?: I18nNamespace[];
}

export const createShareBaseSSR = async <T extends IShareBasePagePropsBase>(
  options: IShareBaseSSROptions<T>
): Promise<GetServerSidePropsResult<T>> => {
  const { ssrApi, context, getResourcePageProps, getExtraProps, i18nNamespaces } = options;
  const { baseId, shareId, slug, ...queryParams } = context.query;

  context.res.setHeader('Content-Security-Policy', 'frame-ancestors *;');
  ssrApi.axios.defaults.headers['cookie'] = context.req.headers.cookie || '';

  try {
    const shareData = await ssrApi.getBaseShare(shareId as string);
    if (shareData.baseId !== baseId || !shareData?.defaultUrl) {
      return { notFound: true };
    }

    ssrApi.configureShareHeaders(shareId as string);

    const queryClient = new QueryClient();
    const base = await ssrApi.getBaseById(baseId as string);
    const parsed = parseBaseSlug(slug as string[]);
    const baseIdStr = baseId as string;

    await Promise.all([
      queryClient.fetchQuery({
        queryKey: ReactQueryKeys.base(baseIdStr),
        queryFn: () => base,
      }),
      queryClient.fetchQuery({
        queryKey: ReactQueryKeys.getBasePermission(baseIdStr),
        queryFn: () => ssrApi.getBasePermission(baseIdStr),
      }),
    ]);

    const ctx: ISSRContext = {
      context,
      queryClient,
      baseId: baseIdStr,
      ssrApi,
      getTranslationsProps: () =>
        getTranslationsProps(context, i18nNamespaces ?? baseAllConfig.i18nNamespaces),
      base,
    };

    const pageProps = await getResourcePageProps(ctx, parsed, queryParams);
    if (!pageProps) {
      return { notFound: true };
    }

    if ('redirect' in pageProps) {
      const destination = pageProps.redirect.destination.replace(
        `/base/${baseId}`,
        `/share/${shareId}/base/${baseId}`
      );
      return { redirect: { ...pageProps.redirect, destination } };
    }

    if ('props' in pageProps) {
      const user = (await getCurrentUser(ssrApi)) as IUser;
      const resolvedProps = await pageProps.props;
      const extraProps = getExtraProps?.(resolvedProps);
      return await buildShareProps<T>(pageProps, shareId as string, user, shareData, extraProps);
    }

    return pageProps as GetServerSidePropsResult<T>;
  } catch (e) {
    return handleShareError<T>(e, shareId as string);
  }
};
