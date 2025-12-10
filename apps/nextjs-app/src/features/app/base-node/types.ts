import type { QueryClient } from '@tanstack/react-query';
import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import type { IGroupPointsVo } from '@teable/openapi';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type { SsrApi } from '@/backend/api/rest/ssr-api';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';
import type { I18nNamespace } from '@/lib/i18n';
import type { IBasePageProps } from '@/lib/type';
export interface ITablePageProps {
  fieldServerData?: IFieldVo[];
  viewServerData?: IViewVo[];
  recordsServerData?: { records: IRecord[] };
  recordServerData?: IRecord;
  groupPointsServerDataMap?: { [viewId: string]: IGroupPointsVo | undefined };
}

export type IBaseNodePageProps = IBasePageProps & Partial<ITablePageProps>;

export interface ISSRContext {
  context: GetServerSidePropsContext;
  queryClient: QueryClient;
  baseId: string;
  ssrApi: SsrApi;
  i18nNamespaces: I18nNamespace[] | I18nNamespace | undefined;
}

export type SSRResult = GetServerSidePropsResult<IBaseNodePageProps>;

export type SSRHandler = (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed,
  queryParams?: Record<string, string | string[] | undefined>
) => Promise<SSRResult>;
