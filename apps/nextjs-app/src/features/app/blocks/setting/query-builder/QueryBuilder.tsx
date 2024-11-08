import { useQuery } from '@tanstack/react-query';
import { CellFormat, FieldKeyType, type IFilterSet, type ISortItem } from '@teable/core';
import { ArrowUpRight } from '@teable/icons';
import type { IQueryBaseRo } from '@teable/openapi';
import { getBaseAll, getTableList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { StandaloneViewProvider } from '@teable/sdk/context';
import { Button, ToggleGroup, ToggleGroupItem } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { Selector } from '@/components/Selector';
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
  const router = useRouter();
  const [baseId, setBaseId] = useState<string>(router.query.baseId as string);
  const [tableId, setTableId] = useState<string>(router.query.tableId as string);
  const [viewId, setViewId] = useState<string>();
  const [filter, setFilter] = useState<IFilterSet | null>(null);
  const [fieldKeyType, setFieldKeyType] = useState<FieldKeyType>();
  const [cellFormat, setCellFormat] = useState<CellFormat>();
  const [orderBy, setOrderBy] = useState<ISortItem[]>();
  const [search, setSearch] = useState<IQueryBaseRo['search']>();
  const { data: baseListReq } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: () => getBaseAll().then((data) => data.data),
  });

  const { data: tableListReq } = useQuery({
    queryKey: ReactQueryKeys.tableList(baseId as string),
    queryFn: () => getTableList(baseId as string).then((data) => data.data),
    enabled: Boolean(baseId),
  });

  return (
    <SettingRight title={<SettingRightTitle title={t('developer:apiQueryBuilder')} />}>
      <StandaloneViewProvider baseId={baseId} tableId={tableId} viewId={viewId}>
        <div className="flex w-full flex-col gap-4 pb-8 pt-4">
          <div className="text-sm">
            {t('developer:subTitle')}{' '}
            <Button variant="link" size="xs" asChild>
              <Link href="/redocs" target="_blank">
                <ArrowUpRight className="size-4" />
                {t('developer:apiList')}
              </Link>
            </Button>
          </div>
          <p>{t('developer:chooseSource')}</p>
          <div className="flex flex-col gap-2">
            <h1>1. {t('common:noun.base')}</h1>
            <Selector
              className="w-80"
              placeholder={t('developer:action.selectBase')}
              candidates={baseListReq}
              selectedId={baseId}
              onChange={(id) => setBaseId(id)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h1>2. {t('common:noun.table')}</h1>
            <Selector
              className="w-80"
              placeholder={t('developer:action.selectTable')}
              candidates={tableListReq}
              selectedId={tableId}
              onChange={(id) => setTableId(id)}
            />
          </div>
          <hr className="my-4" />
          <p>{t('developer:pickParams')}</p>
          {tableId && (
            <>
              <div className="flex flex-col gap-2">
                <h1 className="font-bold">{t('common:noun.view')}</h1>
                <ViewBuilder viewId={viewId} onChange={setViewId} />
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="font-bold">{t('sdk:filter.label')}</h1>
                <FilterBuilder
                  filter={filter}
                  onChange={(f) => {
                    setFilter(f);
                    setFieldKeyType(FieldKeyType.Id);
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="font-bold">{t('sdk:sort.label')}</h1>
                <OrderByBuilder
                  orderBy={orderBy}
                  onChange={(o) => {
                    setOrderBy(o);
                    setFieldKeyType(FieldKeyType.Id);
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="font-bold">{t('common:actions.search')}</h1>
                <SearchBuilder search={search} onChange={setSearch} />
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="font-bold">{t('developer:cellFormat')}</h1>
                <ToggleGroup
                  className="w-auto justify-start"
                  variant="outline"
                  type="single"
                  size="sm"
                  value={cellFormat || CellFormat.Json}
                  onValueChange={(v) => setCellFormat((v as CellFormat) || CellFormat.Json)}
                >
                  <ToggleGroupItem value="json" aria-label="Toggle json">
                    JSON
                  </ToggleGroupItem>
                  <ToggleGroupItem value="text" aria-label="Toggle text">
                    Text
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="flex flex-col gap-2">
                <h1 className="font-bold">{t('developer:fieldKeyType')}</h1>
                <p className="text-xs">{t('developer:fieldKeyTypeDesc')}</p>
                <ToggleGroup
                  className="w-auto justify-start"
                  variant="outline"
                  type="single"
                  size="sm"
                  value={fieldKeyType || FieldKeyType.Name}
                  onValueChange={(v) => {
                    if (orderBy || filter) {
                      setFieldKeyType(FieldKeyType.Id);
                    } else {
                      setFieldKeyType(v as FieldKeyType);
                    }
                  }}
                >
                  <ToggleGroupItem value="name" aria-label="Toggle json">
                    Name
                  </ToggleGroupItem>
                  <ToggleGroupItem value="id" aria-label="Toggle text">
                    Id
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </>
          )}
          <hr className="my-4" />
          {tableId ? (
            <div className="flex flex-col gap-4">
              <h1 className="font-bold">{t('developer:buildResult')}</h1>
              <PreviewScript
                tableId={tableId}
                query={{
                  fieldKeyType,
                  viewId,
                  filter,
                  orderBy,
                  search,
                  cellFormat,
                }}
              />
            </div>
          ) : (
            t('developer:buildResultEmpty')
          )}
          <hr className="my-4" />
          {tableId && (
            <div className="flex w-full flex-col gap-4">
              <h1 className="font-bold">{t('developer:previewReturnValue')}</h1>
              <PreviewTable query={{ filter, orderBy, viewId, search, cellFormat, fieldKeyType }} />
            </div>
          )}
        </div>
      </StandaloneViewProvider>
    </SettingRight>
  );
};
