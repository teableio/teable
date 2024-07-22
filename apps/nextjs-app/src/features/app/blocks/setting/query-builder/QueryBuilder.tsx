import { useQuery } from '@tanstack/react-query';
import { FieldKeyType, type IFilterSet, type ISortItem } from '@teable/core';
import { getBaseAll, getTableList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { AnchorProvider } from '@teable/sdk/context';
import { Selector } from '@teable/ui-lib/base';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { developerConfig } from '@/features/i18n/developer.config';
import { SettingRight } from '../SettingRight';
import { SettingRightTitle } from '../SettingRightTitle';
import { FilterBuilder } from './FilterBuilder';
import { PreviewScript } from './PreviewScript';
import { PreviewTable } from './PreviewTable';
import { SearchBuilder } from './SearchBuilder';
import { OrderByBuilder } from './SortBuilder';
import { ViewBuilder } from './ViewBuilder';

export const QueryBuilder = () => {
  const { t } = useTranslation(developerConfig.i18nNamespaces);
  const [baseId, setBaseId] = useState<string>();
  const [viewId, setViewId] = useState<string>();
  const [tableId, setTableId] = useState<string>();
  const [filter, setFilter] = useState<IFilterSet | null>(null);
  const [orderBy, setOrderBy] = useState<ISortItem[]>();
  const [search, setSearch] = useState<[string, string]>();
  const { data: baseListReq } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: () => getBaseAll(),
  });

  const { data: tableListReq } = useQuery({
    queryKey: ReactQueryKeys.tableList(baseId as string),
    queryFn: () => getTableList(baseId as string),
    enabled: Boolean(baseId),
  });

  return (
    <SettingRight title={<SettingRightTitle title={t('developer:apiQueryBuilder')} />}>
      <div className="flex w-full flex-col gap-4 pt-4">
        <p>{t('developer:chooseSource')}</p>
        <div className="flex flex-col gap-2">
          <h1>1. {t('common:noun.base')}</h1>
          <Selector
            className="w-80"
            placeholder={t('developer:action.selectBase')}
            candidates={baseListReq?.data}
            selectedId={baseId}
            onChange={(id) => setBaseId(id)}
          />
        </div>
        {baseId && (
          <div className="flex flex-col gap-2">
            <h1>2. {t('common:noun.table')}</h1>
            <Selector
              className="w-80"
              placeholder={t('developer:action.selectTable')}
              candidates={tableListReq?.data}
              selectedId={tableId}
              onChange={(id) => setTableId(id)}
            />
          </div>
        )}
        <hr className="my-4" />
        <p>{t('developer:pickParams')}</p>
        {tableId && (
          <div className="flex flex-col gap-2">
            <h1 className="font-bold">{t('common:noun.view')}</h1>
            <AnchorProvider baseId={baseId} tableId={tableId}>
              <ViewBuilder viewId={viewId} onChange={setViewId} />
            </AnchorProvider>
          </div>
        )}
        {tableId && (
          <div className="flex flex-col gap-2">
            <h1 className="font-bold">{t('sdk:filter.label')}</h1>
            <AnchorProvider baseId={baseId} tableId={tableId}>
              <FilterBuilder filter={filter} onChange={setFilter} />
            </AnchorProvider>
          </div>
        )}
        {tableId && (
          <div className="flex flex-col gap-2">
            <h1 className="font-bold">{t('sdk:sort.label')}</h1>
            <AnchorProvider baseId={baseId} tableId={tableId}>
              <OrderByBuilder orderBy={orderBy} onChange={setOrderBy} />
            </AnchorProvider>
          </div>
        )}
        {tableId && (
          <div className="flex flex-col gap-2">
            <h1 className="font-bold">{t('common:actions.search')}</h1>
            <AnchorProvider baseId={baseId} tableId={tableId}>
              <SearchBuilder search={search} onChange={setSearch} />
            </AnchorProvider>
          </div>
        )}
        <hr className="my-4" />
        {tableId ? (
          <div className="flex flex-col gap-4">
            <h1 className="font-bold">{t('developer:buildResult')}</h1>
            <PreviewScript
              tableId={tableId}
              query={{ fieldKeyType: FieldKeyType.Id, viewId, filter, orderBy, search }}
            />
          </div>
        ) : (
          t('developer:buildResultEmpty')
        )}
        <hr className="my-4" />
        {tableId && (
          <div className="flex w-full flex-col gap-4">
            <h1 className="font-bold">{t('developer:previewReturnValue')}</h1>
            <AnchorProvider baseId={baseId} tableId={tableId}>
              <PreviewTable query={{ filter, orderBy, viewId, search }} />
            </AnchorProvider>
          </div>
        )}
      </div>
    </SettingRight>
  );
};
