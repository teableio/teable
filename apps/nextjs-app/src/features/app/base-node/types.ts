import type { QueryClient } from '@tanstack/react-query';
import type { IFieldVo, IRecord, IViewVo } from '@teable/core';
import type { IGroupPointsVo } from '@teable/openapi';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type { SsrApi } from '@/backend/api/rest/ssr-api';
import type { IBaseResourceParsed } from '@/features/app/hooks/useBaseResource';
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
}

export type SSRResult = GetServerSidePropsResult<IBaseNodePageProps>;

export type BuildBaseProps = (
  ctx: ISSRContext,
  extra?: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export type SSRHandler = (
  ctx: ISSRContext,
  parsed: IBaseResourceParsed,
  buildBaseProps: BuildBaseProps,
  queryParams?: Record<string, string | string[] | undefined>
) => Promise<SSRResult>;
